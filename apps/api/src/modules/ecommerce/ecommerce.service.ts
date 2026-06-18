import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES, type EcommerceOrderPlacedV1, type EcommerceOrderStatusChangedV1 } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { InventoryDocsService } from '../inventory/inventory-docs.service';
import { OutboxService } from '../outbox/outbox.service';
import { type FetchedAttachment, StorageService, type UploadedFileLike } from '../storage/storage.service';
import type {
  AddToCartDto,
  CheckoutDto,
  CreateProductDto,
  SetEcGlConfigDto,
  UpdateOrderStatusDto,
  UpdateProductDto,
  UpsertCollectionDto,
  UpsertDiscountDto,
  UpsertStoreDto,
} from './dto/ecommerce.dto';
import {
  type DiscountInput,
  type EcGlAccounts,
  type OrderEmailInfo,
  computeOrderTotals,
  mapCollection,
  mapDiscount,
  mapOrder,
  mapOrderLine,
  mapProduct,
  mapStore,
  nextEcDocNo,
  priceLine,
  shippingFor,
  slugify,
} from './ecommerce.util';

type Row = Record<string, unknown>;
type Mgr = EntityManager;

/** Join an online listing to its inventory product for sku / base price / stock. */
const PRODUCT_SELECT = `
  SELECT p.id, p.product_id, p.slug, p.title, p.subtitle, p.description, p.status, p.is_featured,
         p.sort, p.tax_rate, p.price_minor, p.compare_at_minor,
         ip.sku, ip.sell_price_minor, ip.cost_price_minor, ip.on_hand,
         (SELECT pi.attachment_id FROM ec_product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL
            ORDER BY pi.is_primary DESC, pi.sort, pi.created_at LIMIT 1) AS primary_image_id,
         (SELECT count(*) FROM ec_product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL) AS image_count
  FROM ec_product p
  JOIN inventory_product ip ON ip.id = p.product_id AND ip.deleted_at IS NULL`;

/**
 * E-commerce module — store settings, catalogue (collections + products + images), discount codes,
 * carts, online orders, and GL config. The public storefront (StorefrontController) sets the tenant
 * context then calls the storefront read + cart + checkout methods here; admin CRUD is auth-gated.
 * Stock is decremented through the shared inventory ledger seam, and each placed order is emitted on
 * the outbox for the GL consumer — same patterns as POS.
 */
@Injectable()
export class EcommerceService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly storage: StorageService,
    private readonly inventoryDocs: InventoryDocsService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Store settings ──────────────────────────────────────────────────────────
  async getStore() {
    return this.tenantTx.run(async (m) => {
      const row = await this.storeRow(m);
      const slugRows = (await m.query(
        `SELECT slug FROM tenants WHERE id = current_setting('app.tenant_id')::uuid`,
      )) as Array<{ slug: string }>;
      const storefrontSlug = slugRows[0]?.slug ?? null;
      return row ? { ...mapStore(row), storefrontSlug, configured: true } : { configured: false, storefrontSlug };
    });
  }

  private async storeRow(m: Mgr): Promise<Row | null> {
    const rows = (await m.query(`SELECT * FROM ec_store WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
    return rows[0] ?? null;
  }

  async upsertStore(dto: UpsertStoreDto) {
    return this.tenantTx.run(async (m) => {
      const existing = await this.storeRow(m);
      if (!existing && !dto.name) throw new BadRequestException('name is required to create the store');
      await m.query(
        `INSERT INTO ec_store (tenant_id, name, tagline, description, currency, accent_color, hero_headline,
            hero_subtext, support_email, support_phone, address, default_tax_rate, shipping_flat_minor,
            free_shipping_over_minor, published)
         VALUES (current_setting('app.tenant_id')::uuid,
            COALESCE($1,'My Store'), $2, $3, COALESCE($4,'PKR'), COALESCE($5,'#4f46e5'), $6, $7, $8, $9, $10,
            COALESCE($11,0), COALESCE($12,0), $13, COALESCE($14,false))
         ON CONFLICT (tenant_id) DO UPDATE SET
            name = COALESCE($1, ec_store.name),
            tagline = $2, description = $3,
            currency = COALESCE($4, ec_store.currency),
            accent_color = COALESCE($5, ec_store.accent_color),
            hero_headline = $6, hero_subtext = $7, support_email = $8, support_phone = $9, address = $10,
            default_tax_rate = COALESCE($11, ec_store.default_tax_rate),
            shipping_flat_minor = COALESCE($12, ec_store.shipping_flat_minor),
            free_shipping_over_minor = $13,
            published = COALESCE($14, ec_store.published),
            updated_at = now()`,
        [
          dto.name ?? null, dto.tagline ?? null, dto.description ?? null, dto.currency ?? null,
          dto.accentColor ?? null, dto.heroHeadline ?? null, dto.heroSubtext ?? null, dto.supportEmail ?? null,
          dto.supportPhone ?? null, dto.address ?? null, dto.defaultTaxRate ?? null, dto.shippingFlatMinor ?? null,
          dto.freeShippingOverMinor ?? null, dto.published ?? null,
        ],
      );
      const row = await this.storeRow(m);
      return mapStore(row!);
    });
  }

  async uploadStoreImage(kind: 'logo' | 'hero', file: UploadedFileLike) {
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('Image required');
    const column = kind === 'logo' ? 'logo_attachment_id' : 'hero_attachment_id';
    return this.tenantTx.run(async (m) => {
      const existing = await this.storeRow(m);
      if (!existing) throw new NotFoundException('Create the store before uploading images');
      const prev = existing[column] as string | null;
      const { id } = await this.storage.putInTx(m, `ecommerce.${kind}`, file);
      await m.query(`UPDATE ec_store SET ${column} = $1, updated_at = now() WHERE id = $2`, [id, existing.id]);
      if (prev) await m.query(`UPDATE app_attachment SET deleted_at = now() WHERE id = $1`, [prev]);
      return { ok: true };
    });
  }

  async getStoreImage(kind: 'logo' | 'hero'): Promise<FetchedAttachment | null> {
    const column = kind === 'logo' ? 'logo_attachment_id' : 'hero_attachment_id';
    const attId = await this.tenantTx.run(async (m) => {
      const row = await this.storeRow(m);
      return (row?.[column] as string | null) ?? null;
    });
    if (!attId) return null;
    return this.storage.get(attId, `ecommerce.${kind}`);
  }

  // ── Collections ─────────────────────────────────────────────────────────────
  async listCollections() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT c.*, (SELECT count(*) FROM ec_product_collection pc WHERE pc.collection_id = c.id) AS product_count
         FROM ec_collection c WHERE c.deleted_at IS NULL ORDER BY c.sort, c.title`,
      )) as Row[];
      return rows.map(mapCollection);
    });
  }

  async createCollection(dto: UpsertCollectionDto) {
    return this.tenantTx.run(async (m) => {
      const slug = slugify(dto.slug || dto.title);
      const rows = (await m.query(
        `INSERT INTO ec_collection (tenant_id, title, slug, description, sort, is_featured)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, COALESCE($4,0), COALESCE($5,false))
         RETURNING *`,
        [dto.title, slug, dto.description ?? null, dto.sort ?? null, dto.isFeatured ?? null],
      ).catch(rethrowSlugConflict)) as Row[];
      return mapCollection(rows[0]!);
    });
  }

  async updateCollection(id: string, dto: UpsertCollectionDto) {
    return this.tenantTx.run(async (m) => {
      const slug = dto.slug ? slugify(dto.slug) : undefined;
      const rows = rowsOf(await m.query(
        `UPDATE ec_collection SET title = COALESCE($2, title), slug = COALESCE($3, slug),
            description = $4, sort = COALESCE($5, sort), is_featured = COALESCE($6, is_featured), updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id, dto.title ?? null, slug ?? null, dto.description ?? null, dto.sort ?? null, dto.isFeatured ?? null],
      ).catch(rethrowSlugConflict)) as Row[];
      if (!rows[0]) throw new NotFoundException('Collection not found');
      return mapCollection(rows[0]);
    });
  }

  async deleteCollection(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE ec_collection SET deleted_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  // ── Products ────────────────────────────────────────────────────────────────
  async listProducts(filter?: { status?: string; q?: string }) {
    return this.tenantTx.run(async (m) => {
      const currency = await this.currency(m);
      const conds = ['p.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter?.status) conds.push(`p.status = $${params.push(filter.status)}`);
      if (filter?.q) conds.push(`(p.title ILIKE $${params.push(`%${filter.q}%`)} OR ip.sku ILIKE $${params.length})`);
      const rows = (await m.query(
        `${PRODUCT_SELECT} WHERE ${conds.join(' AND ')} ORDER BY p.sort, p.title`,
        params,
      )) as Row[];
      return rows.map((r) => mapProduct(r, currency));
    });
  }

  async getProduct(id: string) {
    return this.tenantTx.run(async (m) => {
      const currency = await this.currency(m);
      const rows = (await m.query(`${PRODUCT_SELECT} WHERE p.id = $1 AND p.deleted_at IS NULL`, [id])) as Row[];
      if (!rows[0]) throw new NotFoundException('Product not found');
      const collections = (await m.query(
        `SELECT collection_id FROM ec_product_collection WHERE product_id = $1`,
        [id],
      )) as Array<{ collection_id: string }>;
      return { ...mapProduct(rows[0], currency), collectionIds: collections.map((c) => c.collection_id) };
    });
  }

  async createProduct(dto: CreateProductDto) {
    return this.tenantTx.run(async (m) => {
      const inv = (await m.query(
        `SELECT id, name, sku FROM inventory_product WHERE id = $1 AND deleted_at IS NULL`,
        [dto.productId],
      )) as Array<{ id: string; name: string; sku: string }>;
      if (!inv[0]) throw new NotFoundException('Inventory product not found');
      const title = dto.title || inv[0].name;
      const slug = slugify(dto.slug || `${title}-${inv[0].sku}`);
      const rows = (await m.query(
        `INSERT INTO ec_product (tenant_id, product_id, slug, title, subtitle, description, price_minor,
            compare_at_minor, status, is_featured, sort, tax_rate)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7,
            COALESCE($8,'DRAFT'), COALESCE($9,false), COALESCE($10,0), COALESCE($11,0))
         RETURNING id`,
        [dto.productId, slug, title, dto.subtitle ?? null, dto.description ?? null, dto.priceMinor ?? null,
          dto.compareAtMinor ?? null, dto.status ?? null, dto.isFeatured ?? null, dto.sort ?? null, dto.taxRate ?? null],
      ).catch(rethrowProductConflict)) as Array<{ id: string }>;
      const id = rows[0]!.id;
      if (dto.collectionIds) await this.replaceCollections(m, id, dto.collectionIds);
      return this.getProductInTx(m, id);
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    return this.tenantTx.run(async (m) => {
      const slug = dto.slug ? slugify(dto.slug) : undefined;
      const rows = rowsOf(await m.query(
        `UPDATE ec_product SET title = COALESCE($2, title), slug = COALESCE($3, slug), subtitle = $4,
            description = $5, price_minor = $6, compare_at_minor = $7, status = COALESCE($8, status),
            is_featured = COALESCE($9, is_featured), sort = COALESCE($10, sort), tax_rate = COALESCE($11, tax_rate),
            updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id, dto.title ?? null, slug ?? null, dto.subtitle ?? null, dto.description ?? null, dto.priceMinor ?? null,
          dto.compareAtMinor ?? null, dto.status ?? null, dto.isFeatured ?? null, dto.sort ?? null, dto.taxRate ?? null],
      ).catch(rethrowProductConflict)) as Array<{ id: string }>;
      if (!rows[0]) throw new NotFoundException('Product not found');
      if (dto.collectionIds) await this.replaceCollections(m, id, dto.collectionIds);
      return this.getProductInTx(m, id);
    });
  }

  async deleteProduct(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE ec_product SET deleted_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  private async replaceCollections(m: Mgr, productId: string, collectionIds: string[]) {
    await m.query(`DELETE FROM ec_product_collection WHERE product_id = $1`, [productId]);
    for (const cid of collectionIds) {
      await m.query(
        `INSERT INTO ec_product_collection (tenant_id, product_id, collection_id)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2) ON CONFLICT DO NOTHING`,
        [productId, cid],
      );
    }
  }

  private async getProductInTx(m: Mgr, id: string) {
    const currency = await this.currency(m);
    const rows = (await m.query(`${PRODUCT_SELECT} WHERE p.id = $1`, [id])) as Row[];
    return mapProduct(rows[0]!, currency);
  }

  // ── Product images ──────────────────────────────────────────────────────────
  async addProductImage(productId: string, file: UploadedFileLike) {
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('Image required');
    return this.tenantTx.run(async (m) => {
      const exists = (await m.query(`SELECT id FROM ec_product WHERE id = $1 AND deleted_at IS NULL`, [productId])) as Row[];
      if (!exists[0]) throw new NotFoundException('Product not found');
      const { id: attId } = await this.storage.putInTx(m, 'ecommerce.product', file);
      const count = (await m.query(
        `SELECT count(*)::int AS n FROM ec_product_image WHERE product_id = $1 AND deleted_at IS NULL`,
        [productId],
      )) as Array<{ n: number }>;
      const isPrimary = (count[0]?.n ?? 0) === 0;
      const rows = (await m.query(
        `INSERT INTO ec_product_image (tenant_id, product_id, attachment_id, sort, is_primary)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4) RETURNING id`,
        [productId, attId, count[0]?.n ?? 0, isPrimary],
      )) as Array<{ id: string }>;
      return { id: rows[0]!.id, attachmentId: attId, isPrimary };
    });
  }

  async listProductImages(productId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, attachment_id, sort, is_primary FROM ec_product_image
         WHERE product_id = $1 AND deleted_at IS NULL ORDER BY is_primary DESC, sort, created_at`,
        [productId],
      )) as Row[];
      return rows.map((r) => ({
        id: r.id as string,
        attachmentId: r.attachment_id as string,
        sort: Number(r.sort ?? 0),
        isPrimary: !!r.is_primary,
      }));
    });
  }

  async getProductImage(imageId: string): Promise<FetchedAttachment | null> {
    const attId = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT attachment_id FROM ec_product_image WHERE id = $1 AND deleted_at IS NULL`,
        [imageId],
      )) as Array<{ attachment_id: string }>;
      return rows[0]?.attachment_id ?? null;
    });
    if (!attId) return null;
    return this.storage.get(attId, 'ecommerce.product');
  }

  async setPrimaryImage(productId: string, imageId: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE ec_product_image SET is_primary = (id = $2), updated_at = now() WHERE product_id = $1`, [productId, imageId]);
      return { ok: true };
    });
  }

  async removeProductImage(imageId: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE ec_product_image SET deleted_at = now() WHERE id = $1`, [imageId]);
      return { ok: true };
    });
  }

  // ── Discounts ───────────────────────────────────────────────────────────────
  async listDiscounts() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT * FROM ec_discount WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      )) as Row[];
      return rows.map(mapDiscount);
    });
  }

  async createDiscount(dto: UpsertDiscountDto) {
    if (dto.type === 'PERCENT' && dto.value > 100) throw new BadRequestException('Percent discount cannot exceed 100');
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO ec_discount (tenant_id, code, type, value, active, min_subtotal_minor, starts_at, ends_at, usage_limit)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, COALESCE($4,true), COALESCE($5,0), $6, $7, $8)
         RETURNING *`,
        [dto.code.toUpperCase(), dto.type, dto.value, dto.active ?? null, dto.minSubtotalMinor ?? null,
          dto.startsAt ?? null, dto.endsAt ?? null, dto.usageLimit ?? null],
      ).catch((e: unknown) => {
        if (isUnique(e)) throw new ConflictException(`Discount code "${dto.code}" already exists`);
        throw e;
      })) as Row[];
      return mapDiscount(rows[0]!);
    });
  }

  async deleteDiscount(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE ec_discount SET deleted_at = now(), active = false WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  // ── Orders (admin) ──────────────────────────────────────────────────────────
  async listOrders(filter?: { status?: string }) {
    return this.tenantTx.run(async (m) => {
      const conds = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter?.status) conds.push(`status = $${params.push(filter.status)}`);
      const rows = (await m.query(
        `SELECT * FROM ec_order WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
        params,
      )) as Row[];
      return rows.map(mapOrder);
    });
  }

  async getOrder(id: string) {
    return this.tenantTx.run((m) => this.orderWithLines(m, id));
  }

  private async orderWithLines(m: Mgr, id: string) {
    const rows = (await m.query(`SELECT * FROM ec_order WHERE id = $1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Order not found');
    const order = mapOrder(rows[0]);
    const lines = (await m.query(
      `SELECT * FROM ec_order_line WHERE order_id = $1 ORDER BY created_at`,
      [id],
    )) as Row[];
    return { ...order, lines: lines.map((l) => mapOrderLine(l, rows[0]!.currency)) };
  }

  /** Admin status transition. Cancelling/refunding a stock-bearing order restocks each line once. */
  async updateOrderStatus(id: string, dto: UpdateOrderStatusDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT * FROM ec_order WHERE id = $1 AND deleted_at IS NULL`, [id])) as Row[];
      if (!rows[0]) throw new NotFoundException('Order not found');
      const current = rows[0]!.status as string;
      const next = dto.status;
      const reversing = ['CANCELLED', 'REFUNDED'].includes(next) && !['CANCELLED', 'REFUNDED'].includes(current);
      if (reversing) {
        const lines = (await m.query(
          `SELECT product_id, quantity, unit_cost_minor FROM ec_order_line WHERE order_id = $1`,
          [id],
        )) as Array<{ product_id: string | null; quantity: number; unit_cost_minor: number }>;
        for (const l of lines) {
          if (!l.product_id) continue;
          await this.inventoryDocs.applyStockMovement(m, {
            productId: l.product_id,
            warehouseId: (rows[0]!.warehouse_id as string) ?? null,
            docType: 'EC_ORDER_CANCEL',
            docId: id,
            docNo: rows[0]!.order_no as string,
            qtyIn: Number(l.quantity),
            unitCostMinor: Number(l.unit_cost_minor),
            narration: `Restock — order ${rows[0]!.order_no as string} ${next.toLowerCase()}`,
          });
        }
      }
      const paymentStatus = next === 'PAID' ? 'PAID' : next === 'REFUNDED' ? 'REFUNDED' : rows[0]!.payment_status;
      const updated = rowsOf(await m.query(
        `UPDATE ec_order SET status = $2, payment_status = $3, payment_reference = COALESCE($4, payment_reference), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, next, paymentStatus, dto.paymentReference ?? null],
      )) as Row[];
      // Emit a status-change event (outbox) so the customer-email consumer can notify the buyer.
      if (next !== current) {
        const payload: EcommerceOrderStatusChangedV1 = {
          orderId: id,
          orderNo: rows[0]!.order_no as string,
          status: next,
          previousStatus: current,
        };
        await this.outbox.write(m, EVENT_TYPES.ECOMMERCE_ORDER_STATUS_CHANGED, payload);
      }
      return mapOrder(updated[0]!);
    });
  }

  // ── GL config + consumer reads ──────────────────────────────────────────────
  async getGlConfig() {
    return this.tenantTx.run((m) => this.glConfigInTx(m));
  }

  async glConfigInTx(m: Mgr): Promise<EcGlAccounts> {
    const rows = (await m.query(`SELECT * FROM ec_gl_config WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
    const r = rows[0] ?? {};
    return {
      clearingAccountId: (r.clearing_account_id as string) ?? null,
      revenueAccountId: (r.revenue_account_id as string) ?? null,
      taxAccountId: (r.tax_account_id as string) ?? null,
      cogsAccountId: (r.cogs_account_id as string) ?? null,
      inventoryAccountId: (r.inventory_account_id as string) ?? null,
      shippingAccountId: (r.shipping_account_id as string) ?? null,
    };
  }

  async setGlConfig(dto: SetEcGlConfigDto) {
    return this.tenantTx.run(async (m) => {
      await m.query(
        `INSERT INTO ec_gl_config (tenant_id, clearing_account_id, revenue_account_id, tax_account_id,
            cogs_account_id, inventory_account_id, shipping_account_id)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id) DO UPDATE SET clearing_account_id = $1, revenue_account_id = $2,
            tax_account_id = $3, cogs_account_id = $4, inventory_account_id = $5, shipping_account_id = $6, updated_at = now()`,
        [dto.clearingAccountId ?? null, dto.revenueAccountId ?? null, dto.taxAccountId ?? null,
          dto.cogsAccountId ?? null, dto.inventoryAccountId ?? null, dto.shippingAccountId ?? null],
      );
      return this.glConfigInTx(m);
    });
  }

  /** Customer + order summary for the transactional-email consumer. Null if the order is gone. */
  async orderForEmailInTx(m: Mgr, orderId: string): Promise<OrderEmailInfo | null> {
    const rows = (await m.query(
      `SELECT o.order_no, o.customer_name, o.customer_email, o.status, o.payment_method, o.payment_status,
              o.total_minor, o.currency,
              (SELECT count(*) FROM ec_order_line WHERE order_id = o.id) AS line_count,
              COALESCE((SELECT name FROM ec_store WHERE tenant_id = current_setting('app.tenant_id')::uuid AND deleted_at IS NULL LIMIT 1), 'Our store') AS store_name
       FROM ec_order o WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [orderId],
    )) as Row[];
    const r = rows[0];
    if (!r) return null;
    return {
      orderNo: r.order_no as string,
      customerName: r.customer_name as string,
      customerEmail: r.customer_email as string,
      status: r.status as string,
      paymentMethod: r.payment_method as string,
      paymentStatus: r.payment_status as string,
      totalMinor: Number(r.total_minor),
      currency: r.currency as string,
      lineCount: Number(r.line_count),
      storeName: r.store_name as string,
    };
  }

  /** Order financials for the GL consumer (occurredOn from placed_at). */
  async orderForGlInTx(m: Mgr, orderId: string) {
    const rows = (await m.query(
      `SELECT order_no, subtotal_minor, discount_minor, tax_minor, shipping_minor, total_minor, cogs_minor,
              COALESCE(placed_at, created_at)::date::text AS occurred_on
       FROM ec_order WHERE id = $1 AND deleted_at IS NULL`,
      [orderId],
    )) as Row[];
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      orderNo: r.order_no as string,
      subtotalMinor: Number(r.subtotal_minor),
      discountMinor: Number(r.discount_minor),
      taxMinor: Number(r.tax_minor),
      shippingMinor: Number(r.shipping_minor),
      totalMinor: Number(r.total_minor),
      cogsMinor: Number(r.cogs_minor),
      occurredOn: r.occurred_on as string,
    };
  }

  // ── Storefront reads ────────────────────────────────────────────────────────
  /** The published store + its featured collections and featured products, for the storefront home. */
  async storefrontHome() {
    return this.tenantTx.run(async (m) => {
      const store = await this.storeRow(m);
      if (!store || !store.published) throw new NotFoundException('Store not found');
      const currency = (store.currency as string) ?? 'PKR';
      const collections = (await m.query(
        `SELECT c.*, (SELECT count(*) FROM ec_product_collection pc WHERE pc.collection_id = c.id) AS product_count
         FROM ec_collection c WHERE c.deleted_at IS NULL ORDER BY c.sort, c.title`,
      )) as Row[];
      const featured = (await m.query(
        `${PRODUCT_SELECT} WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE' AND p.is_featured = true ORDER BY p.sort, p.title LIMIT 8`,
      )) as Row[];
      const newest = (await m.query(
        `${PRODUCT_SELECT} WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE' ORDER BY p.created_at DESC LIMIT 8`,
      )) as Row[];
      return {
        store: mapStore(store),
        collections: collections.map(mapCollection),
        featured: featured.map((r) => mapProduct(r, currency)),
        newest: newest.map((r) => mapProduct(r, currency)),
      };
    });
  }

  async storefrontProducts(filter?: { collection?: string; q?: string; sort?: string }) {
    return this.tenantTx.run(async (m) => {
      const currency = await this.currency(m);
      const conds = [`p.deleted_at IS NULL`, `p.status = 'ACTIVE'`];
      const params: unknown[] = [];
      if (filter?.collection) {
        conds.push(`p.id IN (SELECT pc.product_id FROM ec_product_collection pc
          JOIN ec_collection c ON c.id = pc.collection_id WHERE c.slug = $${params.push(filter.collection)})`);
      }
      if (filter?.q) conds.push(`p.title ILIKE $${params.push(`%${filter.q}%`)}`);
      const order = filter?.sort === 'price_asc'
        ? 'COALESCE(p.price_minor, ip.sell_price_minor) ASC'
        : filter?.sort === 'price_desc'
          ? 'COALESCE(p.price_minor, ip.sell_price_minor) DESC'
          : 'p.sort, p.title';
      const rows = (await m.query(
        `${PRODUCT_SELECT} WHERE ${conds.join(' AND ')} ORDER BY ${order} LIMIT 100`,
        params,
      )) as Row[];
      return rows.map((r) => mapProduct(r, currency));
    });
  }

  async storefrontProduct(slug: string) {
    return this.tenantTx.run(async (m) => {
      const currency = await this.currency(m);
      const rows = (await m.query(
        `${PRODUCT_SELECT} WHERE p.slug = $1 AND p.deleted_at IS NULL AND p.status = 'ACTIVE'`,
        [slug],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Product not found');
      const images = await this.listProductImages(rows[0]!.id as string);
      return { ...mapProduct(rows[0], currency), images };
    });
  }

  private async currency(m: Mgr): Promise<string> {
    const store = await this.storeRow(m);
    return (store?.currency as string) ?? 'PKR';
  }

  // ── Cart (storefront) ───────────────────────────────────────────────────────
  async createCart() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO ec_cart (tenant_id, token) VALUES (current_setting('app.tenant_id')::uuid, gen_random_uuid()::text) RETURNING token`,
      )) as Array<{ token: string }>;
      return this.cartView(m, rows[0]!.token);
    });
  }

  async getCart(token: string) {
    return this.tenantTx.run((m) => this.cartView(m, token));
  }

  async addToCart(token: string, dto: AddToCartDto) {
    return this.tenantTx.run(async (m) => {
      const cart = await this.cartRow(m, token);
      const prod = await this.activeProduct(m, dto.productId);
      const qty = dto.quantity ?? 1;
      await m.query(
        `INSERT INTO ec_cart_item (tenant_id, cart_id, product_id, quantity, unit_price_minor)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4)
         ON CONFLICT (tenant_id, cart_id, product_id)
         DO UPDATE SET quantity = ec_cart_item.quantity + $3, unit_price_minor = $4`,
        [cart.id, dto.productId, qty, prod.unitPriceMinor],
      );
      return this.cartView(m, token);
    });
  }

  async updateCartItem(token: string, productId: string, quantity: number) {
    return this.tenantTx.run(async (m) => {
      const cart = await this.cartRow(m, token);
      if (quantity <= 0) {
        await m.query(`DELETE FROM ec_cart_item WHERE cart_id = $1 AND product_id = $2`, [cart.id, productId]);
      } else {
        await m.query(`UPDATE ec_cart_item SET quantity = $3 WHERE cart_id = $1 AND product_id = $2`, [cart.id, productId, quantity]);
      }
      return this.cartView(m, token);
    });
  }

  async applyCoupon(token: string, code: string) {
    return this.tenantTx.run(async (m) => {
      const cart = await this.cartRow(m, token);
      const discount = await this.validCoupon(m, code, 0); // existence/active check; subtotal re-checked at checkout
      if (!discount) throw new UnprocessableEntityException('Invalid or expired discount code');
      await m.query(`UPDATE ec_cart SET discount_code = $2, updated_at = now() WHERE id = $1`, [cart.id, code.toUpperCase()]);
      return this.cartView(m, token);
    });
  }

  private async cartRow(m: Mgr, token: string): Promise<{ id: string; discount_code: string | null }> {
    const rows = (await m.query(
      `SELECT id, discount_code FROM ec_cart WHERE token = $1 AND status = 'OPEN'`,
      [token],
    )) as Array<{ id: string; discount_code: string | null }>;
    if (!rows[0]) throw new NotFoundException('Cart not found');
    return rows[0];
  }

  private async cartView(m: Mgr, token: string) {
    const cart = (await m.query(`SELECT * FROM ec_cart WHERE token = $1`, [token])) as Row[];
    if (!cart[0]) throw new NotFoundException('Cart not found');
    const currency = await this.currency(m);
    const items = (await m.query(
      `SELECT ci.product_id, ci.quantity, p.title, p.slug, p.tax_rate,
              COALESCE(p.price_minor, ip.sell_price_minor) AS unit_price_minor,
              (SELECT pi.attachment_id FROM ec_product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL
                 ORDER BY pi.is_primary DESC, pi.sort LIMIT 1) AS primary_image_id
       FROM ec_cart_item ci
       JOIN ec_product p ON p.id = ci.product_id AND p.deleted_at IS NULL
       JOIN inventory_product ip ON ip.id = p.product_id
       WHERE ci.cart_id = $1 ORDER BY ci.created_at`,
      [cart[0]!.id],
    )) as Row[];
    const priced = items.map((r) => priceLine({
      ecProductId: r.product_id as string,
      productId: null,
      title: r.title as string,
      quantity: Number(r.quantity),
      unitPriceMinor: Number(r.unit_price_minor),
      taxRate: Number(r.tax_rate ?? 0),
    }));
    const discount = await this.couponInput(m, cart[0]!.discount_code as string | null);
    const store = await this.storeRow(m);
    const subtotal = priced.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
    const shipping = shippingFor(subtotal, Number(store?.shipping_flat_minor ?? 0), store?.free_shipping_over_minor == null ? null : Number(store.free_shipping_over_minor));
    const totals = computeOrderTotals(priced, discount, shipping);
    return {
      token,
      discountCode: (cart[0]!.discount_code as string) ?? null,
      currency,
      items: items.map((r, i) => ({
        productId: r.product_id as string,
        slug: r.slug as string,
        title: r.title as string,
        quantity: Number(r.quantity),
        unitPriceMinor: priced[i]!.unitPriceMinor,
        lineTotalMinor: priced[i]!.lineTotalMinor,
        primaryImageId: (r.primary_image_id as string) ?? null,
      })),
      totals,
    };
  }

  private async activeProduct(m: Mgr, ecProductId: string) {
    const rows = (await m.query(
      `SELECT p.id, p.product_id, p.title, p.tax_rate, COALESCE(p.price_minor, ip.sell_price_minor) AS unit_price_minor,
              ip.on_hand, ip.cost_price_minor
       FROM ec_product p JOIN inventory_product ip ON ip.id = p.product_id AND ip.deleted_at IS NULL
       WHERE p.id = $1 AND p.deleted_at IS NULL AND p.status = 'ACTIVE'`,
      [ecProductId],
    )) as Row[];
    if (!rows[0]) throw new UnprocessableEntityException('Product unavailable');
    const r = rows[0];
    return {
      ecProductId: r.id as string,
      productId: r.product_id as string,
      title: r.title as string,
      taxRate: Number(r.tax_rate ?? 0),
      unitPriceMinor: Number(r.unit_price_minor),
      onHand: Number(r.on_hand ?? 0),
    };
  }

  private async validCoupon(m: Mgr, code: string, subtotalMinor: number): Promise<Row | null> {
    const rows = (await m.query(
      `SELECT * FROM ec_discount WHERE upper(code) = upper($1) AND active = true AND deleted_at IS NULL
         AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now())
         AND (usage_limit IS NULL OR used_count < usage_limit)
         AND min_subtotal_minor <= $2`,
      [code, subtotalMinor],
    )) as Row[];
    return rows[0] ?? null;
  }

  private async couponInput(m: Mgr, code: string | null): Promise<DiscountInput | null> {
    if (!code) return null;
    const rows = (await m.query(
      `SELECT type, value FROM ec_discount WHERE upper(code) = upper($1) AND active = true AND deleted_at IS NULL`,
      [code],
    )) as Array<{ type: 'PERCENT' | 'FIXED'; value: string }>;
    if (!rows[0]) return null;
    return { type: rows[0].type, value: Number(rows[0].value) };
  }

  // ── Checkout / order placement (storefront) ─────────────────────────────────
  async placeOrder(dto: CheckoutDto) {
    return this.tenantTx.run(async (m) => {
      const store = await this.storeRow(m);
      if (!store) throw new NotFoundException('Store not configured');
      const currency = (store.currency as string) ?? 'PKR';

      // Resolve the lines from a server cart or the directly-passed items.
      let requested: Array<{ productId: string; quantity: number }>;
      let cartId: string | null = null;
      let couponCode: string | null = dto.discountCode?.toUpperCase() ?? null;
      if (dto.cartToken) {
        const cart = await this.cartRow(m, dto.cartToken);
        cartId = cart.id;
        couponCode = couponCode ?? cart.discount_code;
        const items = (await m.query(
          `SELECT product_id, quantity FROM ec_cart_item WHERE cart_id = $1`,
          [cart.id],
        )) as Array<{ product_id: string; quantity: number }>;
        requested = items.map((i) => ({ productId: i.product_id, quantity: Number(i.quantity) }));
      } else if (dto.items?.length) {
        requested = dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
      } else {
        throw new BadRequestException('No items to order');
      }
      if (!requested.length) throw new BadRequestException('Cart is empty');

      // Price + stock-check each line against the live catalogue.
      const priced = [];
      for (const item of requested) {
        const prod = await this.activeProduct(m, item.productId);
        if (prod.onHand < item.quantity) {
          throw new UnprocessableEntityException(`Insufficient stock for "${prod.title}" (have ${prod.onHand})`);
        }
        priced.push(priceLine({
          ecProductId: prod.ecProductId,
          productId: prod.productId,
          title: prod.title,
          quantity: item.quantity,
          unitPriceMinor: prod.unitPriceMinor,
          taxRate: prod.taxRate || Number(store.default_tax_rate ?? 0),
        }));
      }

      const subtotal = priced.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
      const couponRow = couponCode ? await this.validCoupon(m, couponCode, subtotal) : null;
      const discount: DiscountInput | null = couponRow ? { type: couponRow.type as 'PERCENT' | 'FIXED', value: Number(couponRow.value) } : null;
      const shipping = shippingFor(subtotal, Number(store.shipping_flat_minor ?? 0), store.free_shipping_over_minor == null ? null : Number(store.free_shipping_over_minor));
      const totals = computeOrderTotals(priced, discount, shipping);

      const orderNo = await nextEcDocNo(m, 'ORD', 'ORDER');
      const clientId = await this.linkCrmClient(m, dto.customerName, dto.customerEmail, dto.customerPhone ?? null);

      // Decrement stock per line through the valued ledger, capturing COGS.
      let cogsMinor = 0;
      const lineCosts: number[] = [];
      for (const l of priced) {
        const moved = await this.inventoryDocs.applyStockMovement(m, {
          productId: l.productId!,
          warehouseId: null,
          docType: 'EC_ORDER',
          docNo: orderNo,
          qtyOut: l.quantity,
          narration: `Online order ${orderNo}`,
        });
        const lineCost = moved.unitCostMinor * l.quantity;
        lineCosts.push(moved.unitCostMinor);
        cogsMinor += lineCost;
      }

      const card = dto.paymentMethod === 'CARD';
      const paymentReference = card ? `EPAY-${orderNo}` : null;
      const orderRows = (await m.query(
        `INSERT INTO ec_order (tenant_id, order_no, cart_id, client_id, customer_name, customer_email, customer_phone,
            shipping_address, shipping_city, shipping_country, status, payment_method, payment_status, payment_reference,
            subtotal_minor, discount_minor, tax_minor, shipping_minor, total_minor, cogs_minor, currency, discount_code, placed_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, now())
         RETURNING id`,
        [
          orderNo, cartId, clientId, dto.customerName, dto.customerEmail.toLowerCase(), dto.customerPhone ?? null,
          dto.shippingAddress ?? null, dto.shippingCity ?? null, dto.shippingCountry ?? null,
          card ? 'PAID' : 'PENDING', dto.paymentMethod, card ? 'PAID' : 'UNPAID', paymentReference,
          totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.shippingMinor, totals.totalMinor,
          cogsMinor, currency, couponRow ? (couponRow.code as string) : null,
        ],
      )) as Array<{ id: string }>;
      const orderId = orderRows[0]!.id;

      for (let i = 0; i < priced.length; i++) {
        const l = priced[i]!;
        await m.query(
          `INSERT INTO ec_order_line (tenant_id, order_id, ec_product_id, product_id, title, quantity,
              unit_price_minor, tax_rate, tax_minor, line_total_minor, unit_cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [orderId, l.ecProductId, l.productId, l.title, l.quantity, l.unitPriceMinor, l.taxRate, l.taxMinor, l.lineTotalMinor, lineCosts[i]],
        );
      }

      if (cartId) await m.query(`UPDATE ec_cart SET status = 'CONVERTED', updated_at = now() WHERE id = $1`, [cartId]);
      if (couponRow) await m.query(`UPDATE ec_discount SET used_count = used_count + 1 WHERE id = $1`, [couponRow.id]);

      const payload: EcommerceOrderPlacedV1 = {
        orderId,
        orderNo,
        clientId,
        paymentMethod: dto.paymentMethod as 'COD' | 'CARD',
        totalMinor: totals.totalMinor,
        taxMinor: totals.taxMinor,
        shippingMinor: totals.shippingMinor,
        cogsMinor,
        currency,
        lineCount: priced.length,
      };
      await this.outbox.write(m, EVENT_TYPES.ECOMMERCE_ORDER_PLACED, payload);

      return this.orderWithLines(m, orderId);
    });
  }

  /** Look up (by contact email) or create a CRM account for the shopper, so online sales land in CRM. */
  private async linkCrmClient(m: Mgr, name: string, email: string, phone: string | null): Promise<string | null> {
    const existing = (await m.query(
      `SELECT client_id FROM crm_contact WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`,
      [email],
    )) as Array<{ client_id: string }>;
    if (existing[0]) return existing[0].client_id;
    const client = (await m.query(
      `INSERT INTO crm_client (tenant_id, company_name, status) VALUES (current_setting('app.tenant_id')::uuid, $1, 'ACTIVE') RETURNING id`,
      [name],
    )) as Array<{ id: string }>;
    const clientId = client[0]!.id;
    await m.query(
      `INSERT INTO crm_contact (tenant_id, client_id, name, email, phone, is_primary)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, true)`,
      [clientId, name, email.toLowerCase(), phone],
    );
    return clientId;
  }

  /** Fetch a single placed order by number for the public confirmation page (no PII beyond the order). */
  async storefrontOrder(orderNo: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT id FROM ec_order WHERE order_no = $1 AND deleted_at IS NULL`, [orderNo])) as Row[];
      if (!rows[0]) throw new NotFoundException('Order not found');
      return this.orderWithLines(m, rows[0]!.id as string);
    });
  }
}

/** TypeORM returns `[rows, affectedCount]` for UPDATE…RETURNING but a plain array for INSERT/SELECT;
 * normalise to just the rows. */
function rowsOf(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return (res ?? []) as unknown[];
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
function rethrowSlugConflict(e: unknown): never {
  if (isUnique(e)) throw new ConflictException('That slug is already in use');
  throw e;
}
function rethrowProductConflict(e: unknown): never {
  if (isUnique(e)) throw new ConflictException('This product is already listed, or the slug is taken');
  throw e;
}
