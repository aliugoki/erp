import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import { type FetchedAttachment, StorageService, type UploadedFileLike } from '../storage/storage.service';
import type { CreateMovementDto, CreateProductDto, CreateWarehouseDto, UpdateProductDto, UpdateWarehouseDto } from './dto/inventory.dto';
import {
  type MovementType,
  type ProductRow,
  deltaFor,
  isLowStockTransition,
  mapProductRow,
  rowsOf,
} from './inventory.util';

const PRODUCT_COLS =
  'id, sku, name, category, category_id, unit, cost_price_minor, sell_price_minor, currency, min_stock, on_hand';

/** Product SELECT that walks up to three category levels so each row carries its full top→leaf
 * category path (c1 = the product's own category, c2 = its parent, c3 = its grandparent). */
const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.name, p.category, p.category_id, p.unit, p.cost_price_minor, p.sell_price_minor,
         p.currency, p.min_stock, p.on_hand,
         c1.name AS category_name, c2.name AS parent_name, c3.name AS grandparent_name,
         (SELECT i.id FROM inventory_product_image i WHERE i.product_id = p.id AND i.deleted_at IS NULL
            ORDER BY i.is_primary DESC, i.sort, i.created_at LIMIT 1) AS primary_image_id,
         (SELECT count(*) FROM inventory_product_image i WHERE i.product_id = p.id AND i.deleted_at IS NULL) AS image_count
  FROM inventory_product p
  LEFT JOIN inventory_category c1 ON c1.id = p.category_id
  LEFT JOIN inventory_category c2 ON c2.id = c1.parent_id
  LEFT JOIN inventory_category c3 ON c3.id = c2.parent_id`;

/** Allowed image content types for a product image. */
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

@Injectable()
export class InventoryService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
    private readonly storage: StorageService,
  ) {}

  // ── Warehouses ──────────────────────────────────────────────────────────────
  async createWarehouse(dto: CreateWarehouseDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO inventory_warehouse (tenant_id, name, code, location)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3) RETURNING id, name, code, location`,
        [dto.name, dto.code ?? null, dto.location ?? null],
      )) as Array<Record<string, unknown>>;
      return rows[0];
    });
  }

  async listWarehouses() {
    return this.tenantTx.run((m) =>
      m.query(`SELECT id, name, code, location FROM inventory_warehouse WHERE deleted_at IS NULL ORDER BY name`),
    );
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf<Record<string, unknown>>(await m.query(
        `UPDATE inventory_warehouse SET name=COALESCE($2,name), code=COALESCE($3,code), location=COALESCE($4,location), updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL RETURNING id, name, code, location`,
        [id, dto.name ?? null, dto.code ?? null, dto.location ?? null],
      ));
      if (!rows[0]) throw new NotFoundException('Warehouse not found');
      return rows[0];
    });
  }

  // ── Products ────────────────────────────────────────────────────────────────
  async createProduct(dto: CreateProductDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO inventory_product
             (tenant_id, sku, name, category, category_id, unit, cost_price_minor, sell_price_minor, currency, min_stock)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING ${PRODUCT_COLS}`,
          [
            dto.sku,
            dto.name,
            dto.category ?? null,
            dto.categoryId ?? null,
            dto.unit ?? 'unit',
            dto.costPriceMinor ?? 0,
            dto.sellPriceMinor ?? 0,
            dto.currency ?? 'PKR',
            dto.minStock ?? 0,
          ],
        )) as ProductRow[];
        return mapProductRow(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`SKU "${dto.sku}" already exists`);
        if (isForeignKey(err)) throw new BadRequestException('Unknown category for this tenant');
        throw err;
      }
    });
  }

  async listProducts() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `${PRODUCT_SELECT} WHERE p.deleted_at IS NULL ORDER BY p.name`,
      )) as ProductRow[];
      return rows.map(mapProductRow);
    });
  }

  /** Products whose on-hand has fallen below their reorder point. */
  async listLowStock() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `${PRODUCT_SELECT} WHERE p.deleted_at IS NULL AND p.on_hand < p.min_stock ORDER BY (p.min_stock - p.on_hand) DESC`,
      )) as ProductRow[];
      return rows.map(mapProductRow);
    });
  }

  async getProduct(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `${PRODUCT_SELECT} WHERE p.id=$1 AND p.deleted_at IS NULL`,
        [id],
      )) as ProductRow[];
      if (!rows[0]) throw new NotFoundException('Product not found');
      return mapProductRow(rows[0]);
    });
  }

  /** Edit a product's master data (SKU is immutable — it keys the valued ledger). */
  async updateProduct(id: string, dto: UpdateProductDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const updated = rowsOf<{ id: string }>(await m.query(
          `UPDATE inventory_product SET name=COALESCE($2,name), category=COALESCE($3,category), category_id=COALESCE($4,category_id),
              unit=COALESCE($5,unit), cost_price_minor=COALESCE($6,cost_price_minor), sell_price_minor=COALESCE($7,sell_price_minor),
              min_stock=COALESCE($8,min_stock), updated_at=now()
           WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
          [id, dto.name ?? null, dto.category ?? null, dto.categoryId ?? null, dto.unit ?? null,
            dto.costPriceMinor ?? null, dto.sellPriceMinor ?? null, dto.minStock ?? null],
        ));
        if (!updated[0]) throw new NotFoundException('Product not found');
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown category for this tenant');
        throw err;
      }
      const rows = (await m.query(`${PRODUCT_SELECT} WHERE p.id=$1 AND p.deleted_at IS NULL`, [id])) as ProductRow[];
      return mapProductRow(rows[0]!);
    });
  }

  /** Soft-delete a product. Blocked while it still holds stock (on-hand must be zero). */
  async deleteProduct(id: string) {
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT on_hand FROM inventory_product WHERE id=$1 AND deleted_at IS NULL`, [id])) as Array<{ on_hand: number }>;
      if (!cur[0]) throw new NotFoundException('Product not found');
      if (Number(cur[0].on_hand) !== 0) throw new BadRequestException('Cannot delete a product that still holds stock — adjust it to zero first');
      await m.query(`UPDATE inventory_product SET deleted_at=now() WHERE id=$1`, [id]);
      return { id, deleted: true };
    });
  }

  /** Re-classify a product into a category (or clear it with `categoryId = null`). */
  async setProductCategory(id: string, categoryId: string | null) {
    return this.tenantTx.run(async (m) => {
      try {
        const updated = (await m.query(
          `UPDATE inventory_product SET category_id=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
          [id, categoryId ?? null],
        )) as Array<{ id: string }>;
        if (!updated[0]) throw new NotFoundException('Product not found');
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown category for this tenant');
        throw err;
      }
      const rows = (await m.query(`${PRODUCT_SELECT} WHERE p.id=$1 AND p.deleted_at IS NULL`, [id])) as ProductRow[];
      return mapProductRow(rows[0]!);
    });
  }

  // ── Product images ────────────────────────────────────────────────────────────
  /** Attach an image to a product. The first image becomes the primary (thumbnail). */
  async addProductImage(productId: string, file: UploadedFileLike) {
    if (!IMAGE_MIME.has(file.mimetype)) {
      throw new BadRequestException('Image must be a JPEG, PNG, WebP, GIF, or AVIF');
    }
    return this.tenantTx.run(async (m) => {
      const exists = (await m.query(`SELECT 1 FROM inventory_product WHERE id=$1 AND deleted_at IS NULL`, [productId])) as unknown[];
      if (exists.length === 0) throw new NotFoundException('Product not found');
      const { id: attachmentId } = await this.storage.putInTx(m, 'inventory.product_image', file);
      const countRows = (await m.query(`SELECT count(*) AS c FROM inventory_product_image WHERE product_id=$1 AND deleted_at IS NULL`, [productId])) as Array<{ c: string }>;
      const isPrimary = Number(countRows[0]!.c) === 0;
      const rows = (await m.query(
        `INSERT INTO inventory_product_image (tenant_id, product_id, attachment_id, sort, is_primary)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4) RETURNING id`,
        [productId, attachmentId, Number(countRows[0]!.c), isPrimary],
      )) as Array<{ id: string }>;
      return { id: rows[0]!.id, attachmentId, isPrimary, byteSize: file.size ?? file.buffer.length, contentType: file.mimetype };
    });
  }

  async listProductImages(productId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT i.id, i.attachment_id, i.sort, i.is_primary, a.content_type, a.byte_size, a.file_name
         FROM inventory_product_image i JOIN app_attachment a ON a.id = i.attachment_id
         WHERE i.product_id=$1 AND i.deleted_at IS NULL ORDER BY i.is_primary DESC, i.sort, i.created_at`,
        [productId],
      )) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        attachmentId: r.attachment_id as string,
        sort: Number(r.sort ?? 0),
        isPrimary: Boolean(r.is_primary),
        contentType: r.content_type as string,
        byteSize: Number(r.byte_size ?? 0),
        fileName: (r.file_name as string) ?? null,
      }));
    });
  }

  /** Fetch one product image's bytes for streaming. Null if the image isn't found for this product. */
  async getProductImage(productId: string, imageId: string): Promise<FetchedAttachment | null> {
    const attachmentId = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT attachment_id FROM inventory_product_image WHERE id=$1 AND product_id=$2 AND deleted_at IS NULL`,
        [imageId, productId],
      )) as Array<{ attachment_id: string }>;
      return rows[0]?.attachment_id ?? null;
    });
    if (!attachmentId) return null;
    return this.storage.get(attachmentId, 'inventory.product_image');
  }

  async removeProductImage(productId: string, imageId: string) {
    await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT attachment_id, is_primary FROM inventory_product_image WHERE id=$1 AND product_id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [imageId, productId],
      )) as Array<{ attachment_id: string; is_primary: boolean }>;
      if (!rows[0]) throw new NotFoundException('Image not found');
      await m.query(`UPDATE inventory_product_image SET deleted_at=now() WHERE id=$1`, [imageId]);
      await m.query(`UPDATE app_attachment SET deleted_at=now() WHERE id=$1`, [rows[0].attachment_id]);
      if (rows[0].is_primary) {
        // Promote the next remaining image to primary.
        const next = (await m.query(
          `SELECT id FROM inventory_product_image WHERE product_id=$1 AND deleted_at IS NULL ORDER BY sort, created_at LIMIT 1`,
          [productId],
        )) as Array<{ id: string }>;
        if (next[0]) await m.query(`UPDATE inventory_product_image SET is_primary=true, updated_at=now() WHERE id=$1`, [next[0].id]);
      }
    });
  }

  async setPrimaryImage(productId: string, imageId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT 1 FROM inventory_product_image WHERE id=$1 AND product_id=$2 AND deleted_at IS NULL`, [imageId, productId])) as unknown[];
      if (rows.length === 0) throw new NotFoundException('Image not found');
      await m.query(`UPDATE inventory_product_image SET is_primary=false, updated_at=now() WHERE product_id=$1 AND is_primary=true`, [productId]);
      await m.query(`UPDATE inventory_product_image SET is_primary=true, updated_at=now() WHERE id=$1`, [imageId]);
      return this.listProductImagesInTx(m, productId);
    });
  }

  private async listProductImagesInTx(m: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, productId: string) {
    const rows = (await m.query(
      `SELECT i.id, i.attachment_id, i.sort, i.is_primary, a.content_type, a.byte_size, a.file_name
       FROM inventory_product_image i JOIN app_attachment a ON a.id = i.attachment_id
       WHERE i.product_id=$1 AND i.deleted_at IS NULL ORDER BY i.is_primary DESC, i.sort, i.created_at`,
      [productId],
    )) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string, attachmentId: r.attachment_id as string, sort: Number(r.sort ?? 0),
      isPrimary: Boolean(r.is_primary), contentType: r.content_type as string, byteSize: Number(r.byte_size ?? 0), fileName: (r.file_name as string) ?? null,
    }));
  }

  // ── Stock movements (with low-stock outbox event, atomic) ───────────────────
  async createMovement(dto: CreateMovementDto) {
    const type = dto.type as MovementType;
    const delta = deltaFor(type, dto.quantity);

    return this.tenantTx.run(async (m) => {
      // Lock the product row so concurrent movements serialize.
      const prod = (await m.query(
        `SELECT min_stock, on_hand FROM inventory_product WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [dto.productId],
      )) as Array<{ min_stock: number; on_hand: number }>;
      if (!prod[0]) throw new NotFoundException('Product not found');
      const current = prod[0].on_hand;
      const minStock = prod[0].min_stock;
      const next = current + delta;

      let movement: Record<string, unknown>;
      try {
        const mv = (await m.query(
          `INSERT INTO inventory_stock_movement
             (tenant_id, product_id, warehouse_id, to_warehouse_id, type, quantity, reference)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6)
           RETURNING id, product_id, type, quantity, reference`,
          [dto.productId, dto.warehouseId ?? null, dto.toWarehouseId ?? null, type, dto.quantity, dto.reference ?? null],
        )) as Array<Record<string, unknown>>;
        movement = mv[0]!;
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown warehouse for this tenant');
        throw err;
      }

      // Emit BEFORE persisting on_hand: if the on_hand UPDATE fails its CHECK (oversell), the whole
      // transaction — movement + this outbox row — rolls back together (ADR-004 atomicity).
      const lowStock = isLowStockTransition(current, next, minStock);
      if (lowStock) {
        await this.outbox.write(m, EVENT_TYPES.INVENTORY_LOW_STOCK, {
          productId: dto.productId,
          onHand: next,
          minStock,
        });
      }

      try {
        await m.query(`UPDATE inventory_product SET on_hand=$1, updated_at=now() WHERE id=$2`, [next, dto.productId]);
      } catch (err) {
        if (isCheck(err)) {
          throw new UnprocessableEntityException(
            `Insufficient stock: on hand ${current}, requested ${dto.quantity}`,
          );
        }
        throw err;
      }

      return { ...movement, onHand: next, lowStock };
    });
  }

  async listMovements(productId: string) {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT id, product_id, warehouse_id, to_warehouse_id, type, quantity, reference, created_at
         FROM inventory_stock_movement WHERE product_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [productId],
      ),
    );
  }
}

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isUnique = (e: unknown) => code(e) === '23505';
const isForeignKey = (e: unknown) => code(e) === '23503';
const isCheck = (e: unknown) => code(e) === '23514';
