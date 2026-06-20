import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { EVENT_TYPES, type EcommerceOrderPlacedV1, type EcommerceOrderStatusChangedV1 } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { InventoryDocsService } from '../inventory/inventory-docs.service';
import { OutboxService } from '../outbox/outbox.service';
import { type FetchedAttachment, StorageService, type UploadedFileLike } from '../storage/storage.service';
import { PaymentService } from './payment.service';
import type {
  AddToCartDto,
  CheckoutDto,
  CreateProductDto,
  CreateVariantDto,
  SetEcGlConfigDto,
  SetReviewStatusDto,
  SubmitReviewDto,
  UpdateOrderStatusDto,
  UpdateProductDto,
  UpdateVariantDto,
  UpsertCollectionDto,
  UpsertDiscountDto,
  UpsertShippingZoneDto,
  UpsertStoreDto,
} from './dto/ecommerce.dto';
import {
  type DiscountInput,
  type EcGlAccounts,
  type OrderEmailInfo,
  computeOrderTotals,
  mapCollection,
  mapVariant,
  mapDiscount,
  mapOrder,
  mapOrderLine,
  mapProduct,
  mapReview,
  mapShippingZone,
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
         p.sort, p.tax_rate, p.price_minor, p.compare_at_minor, p.seo_title, p.seo_description,
         ip.sku, ip.sell_price_minor, ip.cost_price_minor, ip.on_hand,
         COALESCE((SELECT ic.name FROM inventory_category ic WHERE ic.id = ip.category_id AND ic.deleted_at IS NULL), ip.category) AS category,
         (SELECT pi.id FROM ec_product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL
            ORDER BY pi.is_primary DESC, pi.sort, pi.created_at LIMIT 1) AS primary_image_id,
         (SELECT count(*) FROM ec_product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL) AS image_count,
         (SELECT round(avg(rating), 2) FROM ec_review rv WHERE rv.product_id = p.id AND rv.status = 'APPROVED' AND rv.deleted_at IS NULL) AS rating_avg,
         (SELECT count(*) FROM ec_review rv WHERE rv.product_id = p.id AND rv.status = 'APPROVED' AND rv.deleted_at IS NULL) AS rating_count
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
    private readonly payments: PaymentService,
    private readonly dataSource: DataSource,
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
      const variants = await this.variantsInTx(m, id, false);
      return { ...mapProduct(rows[0], currency), collectionIds: collections.map((c) => c.collection_id), variants };
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
            compare_at_minor, status, is_featured, sort, tax_rate, seo_title, seo_description)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7,
            COALESCE($8,'DRAFT'), COALESCE($9,false), COALESCE($10,0), COALESCE($11,0), $12, $13)
         RETURNING id`,
        [dto.productId, slug, title, dto.subtitle ?? null, dto.description ?? null, dto.priceMinor ?? null,
          dto.compareAtMinor ?? null, dto.status ?? null, dto.isFeatured ?? null, dto.sort ?? null, dto.taxRate ?? null,
          dto.seoTitle ?? null, dto.seoDescription ?? null],
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
            seo_title = $12, seo_description = $13, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id, dto.title ?? null, slug ?? null, dto.subtitle ?? null, dto.description ?? null, dto.priceMinor ?? null,
          dto.compareAtMinor ?? null, dto.status ?? null, dto.isFeatured ?? null, dto.sort ?? null, dto.taxRate ?? null,
          dto.seoTitle ?? null, dto.seoDescription ?? null],
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

  // ── Product variants ──────────────────────────────────────────────────────────
  /** Variants for a product, joined to their inventory SKU for stock/base price. `activeOnly` for the storefront. */
  async variantsInTx(m: Mgr, productId: string, activeOnly: boolean) {
    const currency = await this.currency(m);
    const rows = (await m.query(
      `SELECT v.id, v.product_id, v.inventory_product_id, v.label, v.price_minor, v.compare_at_minor, v.sort, v.is_default, v.status,
              ip.sku, ip.on_hand, ip.sell_price_minor
       FROM ec_product_variant v JOIN inventory_product ip ON ip.id = v.inventory_product_id
       WHERE v.product_id = $1 AND v.deleted_at IS NULL ${activeOnly ? `AND v.status = 'ACTIVE'` : ''}
       ORDER BY v.is_default DESC, v.sort, v.created_at`,
      [productId],
    )) as Row[];
    return rows.map((r) => mapVariant(r, currency));
  }

  async listVariants(productId: string) {
    return this.tenantTx.run((m) => this.variantsInTx(m, productId, false));
  }

  async addVariant(productId: string, dto: CreateVariantDto) {
    return this.tenantTx.run(async (m) => {
      const prod = (await m.query(`SELECT id FROM ec_product WHERE id = $1 AND deleted_at IS NULL`, [productId])) as Row[];
      if (!prod[0]) throw new NotFoundException('Product not found');
      const inv = (await m.query(
        `SELECT name FROM inventory_product WHERE id = $1 AND deleted_at IS NULL`,
        [dto.inventoryProductId],
      )) as Array<{ name: string }>;
      if (!inv[0]) throw new NotFoundException('Inventory product not found');
      if (dto.isDefault) await m.query(`UPDATE ec_product_variant SET is_default = false WHERE product_id = $1`, [productId]);
      const rows = rowsOf(await m.query(
        `INSERT INTO ec_product_variant (tenant_id, product_id, inventory_product_id, label, price_minor, compare_at_minor, sort, is_default)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, COALESCE($6,0), COALESCE($7,false))
         RETURNING id`,
        [productId, dto.inventoryProductId, dto.label || inv[0].name, dto.priceMinor ?? null, dto.compareAtMinor ?? null, dto.sort ?? null, dto.isDefault ?? null],
      ).catch((e: unknown) => {
        if (isUnique(e)) throw new ConflictException('That inventory product is already a variant of this listing');
        throw e;
      })) as Array<{ id: string }>;
      return { id: rows[0]!.id };
    });
  }

  async updateVariant(id: string, dto: UpdateVariantDto) {
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT product_id FROM ec_product_variant WHERE id = $1 AND deleted_at IS NULL`, [id])) as Array<{ product_id: string }>;
      if (!cur[0]) throw new NotFoundException('Variant not found');
      if (dto.isDefault) await m.query(`UPDATE ec_product_variant SET is_default = false WHERE product_id = $1`, [cur[0].product_id]);
      await m.query(
        `UPDATE ec_product_variant SET label = COALESCE($2, label), price_minor = $3, compare_at_minor = $4,
            sort = COALESCE($5, sort), is_default = COALESCE($6, is_default), status = COALESCE($7, status), updated_at = now()
         WHERE id = $1`,
        [id, dto.label ?? null, dto.priceMinor ?? null, dto.compareAtMinor ?? null, dto.sort ?? null, dto.isDefault ?? null, dto.status ?? null],
      );
      return { ok: true };
    });
  }

  async removeVariant(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE ec_product_variant SET deleted_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  // ── Reviews ─────────────────────────────────────────────────────────────────
  /** A signed-in customer submits a review (one per product). Starts PENDING; `verified` if they ordered it. */
  async submitReview(productId: string, customer: { id: string; name: string; email: string }, dto: SubmitReviewDto) {
    return this.tenantTx.run(async (m) => {
      const prod = (await m.query(`SELECT id FROM ec_product WHERE id = $1 AND deleted_at IS NULL AND status = 'ACTIVE'`, [productId])) as Row[];
      if (!prod[0]) throw new NotFoundException('Product not found');
      const ordered = (await m.query(
        `SELECT 1 FROM ec_order_line ol JOIN ec_order o ON o.id = ol.order_id
         WHERE ol.ec_product_id = $1 AND lower(o.customer_email) = lower($2) AND o.deleted_at IS NULL LIMIT 1`,
        [productId, customer.email],
      )) as Row[];
      const verified = ordered.length > 0;
      await m.query(
        `INSERT INTO ec_review (tenant_id, product_id, customer_id, author_name, rating, title, body, verified)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7)`,
        [productId, customer.id, customer.name, dto.rating, dto.title ?? null, dto.body ?? null, verified],
      ).catch((e: unknown) => {
        if (isUnique(e)) throw new ConflictException('You have already reviewed this product');
        throw e;
      });
      return { ok: true, status: 'PENDING' as const, verified };
    });
  }

  /** Approved reviews + rating summary for a product (storefront). */
  async reviewsInTx(m: Mgr, productId: string) {
    const rows = (await m.query(
      `SELECT id, product_id, author_name, rating, title, body, status, verified, created_at
       FROM ec_review WHERE product_id = $1 AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`,
      [productId],
    )) as Row[];
    const agg = (await m.query(
      `SELECT COALESCE(round(avg(rating), 2), 0) AS avg, count(*) AS n FROM ec_review WHERE product_id = $1 AND status = 'APPROVED' AND deleted_at IS NULL`,
      [productId],
    )) as Array<{ avg: string; n: string }>;
    return { reviews: rows.map(mapReview), ratingAvg: Number(agg[0]?.avg ?? 0), ratingCount: Number(agg[0]?.n ?? 0) };
  }

  async listReviews(filter?: { status?: string }) {
    return this.tenantTx.run(async (m) => {
      const conds = ['r.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter?.status) conds.push(`r.status = $${params.push(filter.status)}`);
      const rows = (await m.query(
        `SELECT r.id, r.product_id, r.author_name, r.rating, r.title, r.body, r.status, r.verified, r.created_at, p.title AS product_title
         FROM ec_review r JOIN ec_product p ON p.id = r.product_id
         WHERE ${conds.join(' AND ')} ORDER BY r.created_at DESC LIMIT 200`,
        params,
      )) as Row[];
      return rows.map(mapReview);
    });
  }

  async setReviewStatus(id: string, dto: SetReviewStatusDto) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE ec_review SET status = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id, dto.status],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Review not found');
      return mapReview(rows[0]);
    });
  }

  async deleteReview(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE ec_review SET deleted_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  // ── Shipping zones ──────────────────────────────────────────────────────────
  async listShippingZones() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT * FROM ec_shipping_zone WHERE deleted_at IS NULL ORDER BY sort, created_at`)) as Row[];
      return rows.map(mapShippingZone);
    });
  }

  async createShippingZone(dto: UpsertShippingZoneDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO ec_shipping_zone (tenant_id, name, countries, rate_minor, free_over_minor, sort, enabled)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2::text[], COALESCE($3,0), $4, COALESCE($5,0), COALESCE($6,true))
         RETURNING *`,
        [dto.name, normCountries(dto.countries), dto.rateMinor ?? null, dto.freeOverMinor ?? null, dto.sort ?? null, dto.enabled ?? null],
      )) as Row[];
      return mapShippingZone(rows[0]!);
    });
  }

  async updateShippingZone(id: string, dto: UpsertShippingZoneDto) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE ec_shipping_zone SET name = COALESCE($2, name), countries = COALESCE($3::text[], countries),
            rate_minor = COALESCE($4, rate_minor), free_over_minor = $5, sort = COALESCE($6, sort),
            enabled = COALESCE($7, enabled), updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id, dto.name ?? null, dto.countries ? normCountries(dto.countries) : null, dto.rateMinor ?? null, dto.freeOverMinor ?? null, dto.sort ?? null, dto.enabled ?? null],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Shipping zone not found');
      return mapShippingZone(rows[0]);
    });
  }

  async removeShippingZone(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE ec_shipping_zone SET deleted_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  /** A public shipping quote for a destination + subtotal (used by checkout when the country changes). */
  async shippingQuote(country: string | undefined, subtotalMinor: number) {
    return this.tenantTx.run(async (m) => {
      const store = await this.storeRow(m);
      const shippingMinor = await this.resolveShippingInTx(m, country ?? null, subtotalMinor, store);
      return { shippingMinor, currency: (store?.currency as string) ?? 'PKR' };
    });
  }

  /** Resolve the shipping charge: a zone matching the country (specific first, then catch-all), else the
   * store's default flat/free-over. */
  private async resolveShippingInTx(m: Mgr, country: string | null, subtotalMinor: number, store: Row | null): Promise<number> {
    const zones = (await m.query(
      `SELECT countries, rate_minor, free_over_minor FROM ec_shipping_zone WHERE enabled = true AND deleted_at IS NULL ORDER BY sort, created_at`,
    )) as Array<{ countries: string[]; rate_minor: string; free_over_minor: string | null }>;
    if (zones.length > 0) {
      const c = (country ?? '').trim().toLowerCase();
      const specific = c ? zones.find((z) => (z.countries ?? []).map((x) => x.toLowerCase()).includes(c)) : undefined;
      const catchAll = zones.find((z) => !z.countries || z.countries.length === 0);
      const zone = specific ?? catchAll;
      if (zone) return shippingFor(subtotalMinor, Number(zone.rate_minor), zone.free_over_minor == null ? null : Number(zone.free_over_minor));
    }
    return shippingFor(subtotalMinor, Number(store?.shipping_flat_minor ?? 0), store?.free_shipping_over_minor == null ? null : Number(store.free_shipping_over_minor));
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

  // ── Expired-order release (stock held by unpaid card orders) ──────────────────
  /** Cancel + restock one order (used by the expiry sweep). Returns true if it acted. */
  private async cancelAndRestockInTx(m: Mgr, orderId: string): Promise<boolean> {
    const rows = (await m.query(`SELECT order_no, status, warehouse_id FROM ec_order WHERE id = $1 AND deleted_at IS NULL`, [orderId])) as Row[];
    const o = rows[0];
    if (!o || ['CANCELLED', 'REFUNDED'].includes(o.status as string)) return false;
    const lines = (await m.query(
      `SELECT product_id, quantity, unit_cost_minor FROM ec_order_line WHERE order_id = $1`,
      [orderId],
    )) as Array<{ product_id: string | null; quantity: number; unit_cost_minor: number }>;
    for (const l of lines) {
      if (!l.product_id) continue;
      await this.inventoryDocs.applyStockMovement(m, {
        productId: l.product_id,
        warehouseId: (o.warehouse_id as string) ?? null,
        docType: 'EC_ORDER_EXPIRE',
        docId: orderId,
        docNo: o.order_no as string,
        qtyIn: Number(l.quantity),
        unitCostMinor: Number(l.unit_cost_minor),
        narration: `Auto-released — order ${o.order_no as string} unpaid past expiry`,
      });
    }
    await m.query(`UPDATE ec_order SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [orderId]);
    await m.query(`UPDATE ec_payment SET status = 'CANCELLED', updated_at = now() WHERE order_id = $1 AND status = 'PENDING'`, [orderId]);
    const payload: EcommerceOrderStatusChangedV1 = { orderId, orderNo: o.order_no as string, status: 'CANCELLED', previousStatus: o.status as string };
    await this.outbox.write(m, EVENT_TYPES.ECOMMERCE_ORDER_STATUS_CHANGED, payload);
    return true;
  }

  /** Cancel + restock every card order whose payment session lapsed unpaid. */
  private async releaseExpiredInTx(m: Mgr): Promise<number> {
    const orders = (await m.query(
      `SELECT DISTINCT o.id FROM ec_order o JOIN ec_payment p ON p.order_id = o.id
       WHERE o.status = 'PENDING' AND o.payment_method = 'CARD' AND o.payment_status = 'UNPAID' AND o.deleted_at IS NULL
         AND p.status = 'PENDING' AND p.expires_at IS NOT NULL AND p.expires_at < now()`,
    )) as Array<{ id: string }>;
    let n = 0;
    for (const { id } of orders) if (await this.cancelAndRestockInTx(m, id)) n++;
    return n;
  }

  /** Release expired holds for the current tenant (admin-triggered). */
  async releaseExpired() {
    return this.tenantTx.run(async (m) => ({ released: await this.releaseExpiredInTx(m) }));
  }

  /** Release expired holds across all tenants (the scheduled sweep). */
  async releaseExpiredAllTenants(): Promise<number> {
    const tenants = (await this.dataSource.query(`SELECT id FROM tenants WHERE deleted_at IS NULL`)) as Array<{ id: string }>;
    let total = 0;
    for (const { id } of tenants) {
      try {
        total += await this.tenantTx.runFor(id, (m) => this.releaseExpiredInTx(m));
      } catch {
        /* one tenant's failure shouldn't stop the sweep */
      }
    }
    return total;
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
      const id = rows[0]!.id as string;
      const images = await this.listProductImages(id);
      const variants = await this.variantsInTx(m, id, true);
      const reviews = await this.reviewsInTx(m, id);
      return { ...mapProduct(rows[0], currency), images, variants, ...reviews };
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
      const prod = await this.resolvePurchasable(m, dto.productId, dto.variantId);
      const qty = dto.quantity ?? 1;
      // Manual upsert keyed by (cart, product, variant) — `IS NOT DISTINCT FROM` matches a null variant.
      const existing = (await m.query(
        `SELECT id FROM ec_cart_item WHERE cart_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3`,
        [cart.id, dto.productId, prod.variantId],
      )) as Array<{ id: string }>;
      if (existing[0]) {
        await m.query(`UPDATE ec_cart_item SET quantity = quantity + $2, unit_price_minor = $3 WHERE id = $1`, [existing[0].id, qty, prod.unitPriceMinor]);
      } else {
        await m.query(
          `INSERT INTO ec_cart_item (tenant_id, cart_id, product_id, variant_id, quantity, unit_price_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5)`,
          [cart.id, dto.productId, prod.variantId, qty, prod.unitPriceMinor],
        );
      }
      return this.cartView(m, token);
    });
  }

  async updateCartItem(token: string, productId: string, quantity: number, variantId?: string | null) {
    return this.tenantTx.run(async (m) => {
      const cart = await this.cartRow(m, token);
      if (quantity <= 0) {
        await m.query(`DELETE FROM ec_cart_item WHERE cart_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3`, [cart.id, productId, variantId ?? null]);
      } else {
        await m.query(`UPDATE ec_cart_item SET quantity = $3 WHERE cart_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $4`, [cart.id, productId, quantity, variantId ?? null]);
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
      `SELECT ci.product_id, ci.variant_id, ci.quantity, ci.unit_price_minor, p.title, p.slug, p.tax_rate,
              v.label AS variant_label,
              (SELECT pi.attachment_id FROM ec_product_image pi WHERE pi.product_id = p.id AND pi.deleted_at IS NULL
                 ORDER BY pi.is_primary DESC, pi.sort LIMIT 1) AS primary_image_id
       FROM ec_cart_item ci
       JOIN ec_product p ON p.id = ci.product_id AND p.deleted_at IS NULL
       LEFT JOIN ec_product_variant v ON v.id = ci.variant_id
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
        variantId: (r.variant_id as string) ?? null,
        variantLabel: (r.variant_label as string) ?? null,
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

  /**
   * Resolve the purchasable unit for an add-to-cart / checkout request. A product with variants sells
   * through its variants (each backed by its own inventory product); `variantId` picks one, else the
   * default variant is used. A product with no variants sells its base inventory product directly.
   * Returns the inventory product to move stock against, the effective price, and on-hand qty.
   */
  private async resolvePurchasable(m: Mgr, ecProductId: string, variantId?: string | null) {
    const prodRows = (await m.query(
      `SELECT p.id, p.product_id, p.title, p.tax_rate, p.price_minor, ip.sell_price_minor AS base_sell, ip.on_hand AS base_on_hand,
              (SELECT count(*) FROM ec_product_variant v WHERE v.product_id = p.id AND v.deleted_at IS NULL AND v.status = 'ACTIVE') AS variant_count
       FROM ec_product p JOIN inventory_product ip ON ip.id = p.product_id AND ip.deleted_at IS NULL
       WHERE p.id = $1 AND p.deleted_at IS NULL AND p.status = 'ACTIVE'`,
      [ecProductId],
    )) as Row[];
    if (!prodRows[0]) throw new UnprocessableEntityException('Product unavailable');
    const p = prodRows[0];
    const hasVariants = Number(p.variant_count ?? 0) > 0;

    if (hasVariants || variantId) {
      const vRows = (await m.query(
        `SELECT v.id, v.label, v.price_minor, v.inventory_product_id, iv.on_hand, iv.sell_price_minor
         FROM ec_product_variant v JOIN inventory_product iv ON iv.id = v.inventory_product_id AND iv.deleted_at IS NULL
         WHERE v.product_id = $1 AND v.deleted_at IS NULL AND v.status = 'ACTIVE' AND ($2::uuid IS NULL OR v.id = $2)
         ORDER BY v.is_default DESC, v.sort, v.created_at LIMIT 1`,
        [ecProductId, variantId ?? null],
      )) as Row[];
      if (!vRows[0]) throw new UnprocessableEntityException('Selected option is unavailable');
      const v = vRows[0];
      const priceMinor = v.price_minor != null ? Number(v.price_minor)
        : p.price_minor != null ? Number(p.price_minor) : Number(v.sell_price_minor ?? 0);
      return {
        ecProductId: p.id as string,
        productId: v.inventory_product_id as string,
        variantId: v.id as string,
        title: p.title as string,
        variantLabel: v.label as string,
        taxRate: Number(p.tax_rate ?? 0),
        unitPriceMinor: priceMinor,
        onHand: Number(v.on_hand ?? 0),
      };
    }

    return {
      ecProductId: p.id as string,
      productId: p.product_id as string,
      variantId: null as string | null,
      title: p.title as string,
      variantLabel: null as string | null,
      taxRate: Number(p.tax_rate ?? 0),
      unitPriceMinor: p.price_minor != null ? Number(p.price_minor) : Number(p.base_sell ?? 0),
      onHand: Number(p.base_on_hand ?? 0),
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
      let requested: Array<{ productId: string; variantId: string | null; quantity: number }>;
      let cartId: string | null = null;
      let couponCode: string | null = dto.discountCode?.toUpperCase() ?? null;
      if (dto.cartToken) {
        const cart = await this.cartRow(m, dto.cartToken);
        cartId = cart.id;
        couponCode = couponCode ?? cart.discount_code;
        const items = (await m.query(
          `SELECT product_id, variant_id, quantity FROM ec_cart_item WHERE cart_id = $1`,
          [cart.id],
        )) as Array<{ product_id: string; variant_id: string | null; quantity: number }>;
        requested = items.map((i) => ({ productId: i.product_id, variantId: i.variant_id ?? null, quantity: Number(i.quantity) }));
      } else if (dto.items?.length) {
        requested = dto.items.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity }));
      } else {
        throw new BadRequestException('No items to order');
      }
      if (!requested.length) throw new BadRequestException('Cart is empty');

      // Price + stock-check each line (per variant) against the live catalogue.
      const priced = [];
      for (const item of requested) {
        const prod = await this.resolvePurchasable(m, item.productId, item.variantId);
        if (prod.onHand < item.quantity) {
          const name = prod.variantLabel ? `${prod.title} (${prod.variantLabel})` : prod.title;
          throw new UnprocessableEntityException(`Insufficient stock for "${name}" (have ${prod.onHand})`);
        }
        priced.push({
          ...priceLine({
            ecProductId: prod.ecProductId,
            productId: prod.productId,
            title: prod.title,
            quantity: item.quantity,
            unitPriceMinor: prod.unitPriceMinor,
            taxRate: prod.taxRate || Number(store.default_tax_rate ?? 0),
          }),
          variantId: prod.variantId,
          variantLabel: prod.variantLabel,
        });
      }

      const subtotal = priced.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
      const couponRow = couponCode ? await this.validCoupon(m, couponCode, subtotal) : null;
      const discount: DiscountInput | null = couponRow ? { type: couponRow.type as 'PERCENT' | 'FIXED', value: Number(couponRow.value) } : null;
      const shipping = await this.resolveShippingInTx(m, dto.shippingCountry ?? null, subtotal, store);
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

      // The order is created PENDING / UNPAID for both methods. COD is collected on delivery; CARD is
      // confirmed by a payment session (below) — neither is optimistically marked paid.
      const orderRows = (await m.query(
        `INSERT INTO ec_order (tenant_id, order_no, cart_id, client_id, customer_name, customer_email, customer_phone,
            shipping_address, shipping_city, shipping_country, status, payment_method, payment_status, payment_reference,
            subtotal_minor, discount_minor, tax_minor, shipping_minor, total_minor, cogs_minor, currency, discount_code, placed_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9,
            'PENDING', $10, 'UNPAID', NULL, $11, $12, $13, $14, $15, $16, $17, $18, now())
         RETURNING id`,
        [
          orderNo, cartId, clientId, dto.customerName, dto.customerEmail.toLowerCase(), dto.customerPhone ?? null,
          dto.shippingAddress ?? null, dto.shippingCity ?? null, dto.shippingCountry ?? null,
          dto.paymentMethod,
          totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.shippingMinor, totals.totalMinor,
          cogsMinor, currency, couponRow ? (couponRow.code as string) : null,
        ],
      )) as Array<{ id: string }>;
      const orderId = orderRows[0]!.id;

      for (let i = 0; i < priced.length; i++) {
        const l = priced[i]!;
        await m.query(
          `INSERT INTO ec_order_line (tenant_id, order_id, ec_product_id, product_id, variant_id, variant_label, title, quantity,
              unit_price_minor, tax_rate, tax_minor, line_total_minor, unit_cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [orderId, l.ecProductId, l.productId, l.variantId, l.variantLabel, l.title, l.quantity, l.unitPriceMinor, l.taxRate, l.taxMinor, l.lineTotalMinor, lineCosts[i]],
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

      const result = await this.orderWithLines(m, orderId);
      // A card order needs a payment session the storefront sends the buyer to before confirmation.
      if (dto.paymentMethod === 'CARD') {
        const session = await this.payments.createSessionInTx(m, { id: orderId, orderNo, totalMinor: totals.totalMinor, currency });
        return { ...result, payment: session };
      }
      return result;
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
/** Trim + lowercase a country list for case-insensitive zone matching (drops blanks). */
function normCountries(countries?: string[]): string[] {
  return (countries ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
}
function rethrowSlugConflict(e: unknown): never {
  if (isUnique(e)) throw new ConflictException('That slug is already in use');
  throw e;
}
function rethrowProductConflict(e: unknown): never {
  if (isUnique(e)) throw new ConflictException('This product is already listed, or the slug is taken');
  throw e;
}
