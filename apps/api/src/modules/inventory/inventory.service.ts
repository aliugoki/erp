import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type { CreateMovementDto, CreateProductDto, CreateWarehouseDto } from './dto/inventory.dto';
import {
  type MovementType,
  type ProductRow,
  deltaFor,
  isLowStockTransition,
  mapProductRow,
} from './inventory.util';

const PRODUCT_COLS =
  'id, sku, name, category, unit, cost_price_minor, sell_price_minor, currency, min_stock, on_hand';

@Injectable()
export class InventoryService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
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

  // ── Products ────────────────────────────────────────────────────────────────
  async createProduct(dto: CreateProductDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO inventory_product
             (tenant_id, sku, name, category, unit, cost_price_minor, sell_price_minor, currency, min_stock)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING ${PRODUCT_COLS}`,
          [
            dto.sku,
            dto.name,
            dto.category ?? null,
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
        throw err;
      }
    });
  }

  async listProducts() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${PRODUCT_COLS} FROM inventory_product WHERE deleted_at IS NULL ORDER BY name`,
      )) as ProductRow[];
      return rows.map(mapProductRow);
    });
  }

  /** Products whose on-hand has fallen below their reorder point. */
  async listLowStock() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${PRODUCT_COLS} FROM inventory_product WHERE deleted_at IS NULL AND on_hand < min_stock ORDER BY (min_stock - on_hand) DESC`,
      )) as ProductRow[];
      return rows.map(mapProductRow);
    });
  }

  async getProduct(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${PRODUCT_COLS} FROM inventory_product WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as ProductRow[];
      if (!rows[0]) throw new NotFoundException('Product not found');
      return mapProductRow(rows[0]);
    });
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
        await this.outbox.write(m, 'inventory.low_stock', {
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
