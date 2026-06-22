import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateDrugDto, SetPharmacyConfigDto, UpdateDrugDto, ListDrugsQueryDto } from './dto/pharmacy.dto';
import { type PriceTier, type Row, money } from './pharmacy.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isUnique = (e: unknown) => code(e) === '23505';
const isForeignKey = (e: unknown) => code(e) === '23503';

/**
 * Pharmacy configuration + drug master. A drug enriches an `inventory_product` (1:1) with pharma
 * metadata; stock/value live on the product + the valued ledger, batch/expiry on `pharmacy_stock_lot`.
 */
@Injectable()
export class PharmacyService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  // ── Configuration (one row per tenant) ────────────────────────────────────────
  async getConfig() {
    return this.tenantTx.run(async (m) => this.readConfig(m));
  }

  private async readConfig(m: Mgr) {
    const rows = (await m.query(
      `SELECT mode, controlled_register_enabled, near_expiry_days, allow_dispense_without_stock,
              default_warehouse_id, default_tax_bp, currency
       FROM pharmacy_config WHERE deleted_at IS NULL LIMIT 1`,
    )) as Row[];
    const r = rows[0];
    return {
      mode: (r?.mode as string) ?? 'RETAIL',
      controlledRegisterEnabled: r ? Boolean(r.controlled_register_enabled) : true,
      nearExpiryDays: r ? Number(r.near_expiry_days) : 90,
      allowDispenseWithoutStock: r ? Boolean(r.allow_dispense_without_stock) : false,
      defaultWarehouseId: (r?.default_warehouse_id as string) ?? null,
      defaultTaxBp: r ? Number(r.default_tax_bp) : 0,
      currency: (r?.currency as string) ?? 'PKR',
    };
  }

  async setConfig(dto: SetPharmacyConfigDto) {
    return this.tenantTx.run(async (m) => {
      const exists = (await m.query(`SELECT id FROM pharmacy_config WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
      if (exists[0]) {
        const sets: string[] = [];
        const params: unknown[] = [];
        const set = (col: string, val: unknown) => {
          if (val !== undefined) {
            sets.push(`${col}=$${params.push(val)}`);
          }
        };
        set('mode', dto.mode);
        set('controlled_register_enabled', dto.controlledRegisterEnabled);
        set('near_expiry_days', dto.nearExpiryDays);
        set('allow_dispense_without_stock', dto.allowDispenseWithoutStock);
        set('default_warehouse_id', dto.defaultWarehouseId);
        set('default_tax_bp', dto.defaultTaxBp);
        set('currency', dto.currency);
        if (sets.length) {
          await m.query(`UPDATE pharmacy_config SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(exists[0].id)}`, params);
        }
      } else {
        await m.query(
          `INSERT INTO pharmacy_config
             (tenant_id, mode, controlled_register_enabled, near_expiry_days, allow_dispense_without_stock,
              default_warehouse_id, default_tax_bp, currency)
           VALUES (current_setting('app.tenant_id')::uuid, COALESCE($1,'RETAIL'), COALESCE($2,true), COALESCE($3,90),
                   COALESCE($4,false), $5, COALESCE($6,0), COALESCE($7,'PKR'))`,
          [
            dto.mode ?? null, dto.controlledRegisterEnabled ?? null, dto.nearExpiryDays ?? null,
            dto.allowDispenseWithoutStock ?? null, dto.defaultWarehouseId ?? null, dto.defaultTaxBp ?? null, dto.currency ?? null,
          ],
        );
      }
      return this.readConfig(m);
    });
  }

  // ── Drug master ───────────────────────────────────────────────────────────────
  async createDrug(dto: CreateDrugDto) {
    return this.tenantTx.run(async (m) => {
      let productId = dto.productId ?? null;
      if (!productId) {
        if (!dto.sku || !dto.name) {
          throw new BadRequestException('Provide an existing productId, or sku + name to create one');
        }
        try {
          const prod = (await m.query(
            `INSERT INTO inventory_product (tenant_id, sku, name, unit, sell_price_minor, currency)
             VALUES (current_setting('app.tenant_id')::uuid, $1,$2,'unit',0,'PKR') RETURNING id`,
            [dto.sku, dto.name],
          )) as Row[];
          productId = prod[0]!.id as string;
        } catch (err) {
          if (isUnique(err)) throw new BadRequestException(`SKU "${dto.sku}" already exists`);
          throw err;
        }
      } else {
        const prod = (await m.query(`SELECT id FROM inventory_product WHERE id=$1 AND deleted_at IS NULL`, [productId])) as Row[];
        if (!prod[0]) throw new BadRequestException('Unknown product for this tenant');
      }

      try {
        const rows = (await m.query(
          `INSERT INTO pharmacy_drug
             (tenant_id, product_id, generic_name, brand, manufacturer, strength, form, pack_size, schedule,
              rx_required, controlled, therapeutic_category, barcode, reorder_level, max_level, storage)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,COALESCE($6,'TABLET'),COALESCE($7,1),
                   COALESCE($8,'OTC'),COALESCE($9,false),COALESCE($10,false),$11,$12,COALESCE($13,0),$14,COALESCE($15,'ROOM'))
           RETURNING id`,
          [
            productId, dto.genericName ?? null, dto.brand ?? null, dto.manufacturer ?? null, dto.strength ?? null,
            dto.form ?? null, dto.packSize ?? null, dto.schedule ?? null, dto.rxRequired ?? null, dto.controlled ?? null,
            dto.therapeuticCategory ?? null, dto.barcode ?? null, dto.reorderLevel ?? null, dto.maxLevel ?? null, dto.storage ?? null,
          ],
        )) as Row[];
        return this.getDrugInTx(m, rows[0]!.id as string);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException('This product is already a registered drug');
        if (isForeignKey(err)) throw new BadRequestException('Unknown product for this tenant');
        throw err;
      }
    });
  }

  async listDrugs(query: ListDrugsQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['d.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.q) {
        const i = params.push(`%${query.q.toLowerCase()}%`);
        conds.push(`(lower(p.name) LIKE $${i} OR lower(d.generic_name) LIKE $${i} OR lower(d.brand) LIKE $${i} OR lower(p.sku) LIKE $${i})`);
      }
      if (query.schedule) conds.push(`d.schedule = $${params.push(query.schedule)}`);
      if (query.controlled) conds.push(`d.controlled = $${params.push(query.controlled === 'true')}`);
      const rows = (await m.query(
        `SELECT d.id, d.product_id, p.sku, p.name, d.generic_name, d.brand, d.strength, d.form, d.schedule,
                d.rx_required, d.controlled, d.reorder_level, p.on_hand, p.sell_price_minor, p.cost_price_minor,
                p.currency, d.status
         FROM pharmacy_drug d JOIN inventory_product p ON p.id = d.product_id
         WHERE ${conds.join(' AND ')} ORDER BY p.name`,
        params,
      )) as Row[];
      return rows.map((r) => this.mapDrugList(r));
    });
  }

  async getDrug(id: string) {
    return this.tenantTx.run((m) => this.getDrugInTx(m, id));
  }

  /** Read a drug WITHIN an existing transaction — so create/update can return the row they just wrote
   * (a fresh tenantTx.run would be a new transaction that cannot see the uncommitted write). */
  private async getDrugInTx(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT d.id, d.product_id, p.sku, p.name, d.generic_name, d.brand, d.manufacturer, d.strength, d.form,
              d.pack_size, d.schedule, d.rx_required, d.controlled, d.therapeutic_category, d.barcode,
              d.reorder_level, d.max_level, d.storage, d.status,
              p.on_hand, p.sell_price_minor, p.cost_price_minor, p.stock_value_minor, p.currency
       FROM pharmacy_drug d JOIN inventory_product p ON p.id = d.product_id
       WHERE d.id=$1 AND d.deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Drug not found');
    const r = rows[0];
    const cur = r.currency as string;
    return {
      id: r.id, productId: r.product_id, sku: r.sku, name: r.name,
      genericName: r.generic_name ?? null, brand: r.brand ?? null, manufacturer: r.manufacturer ?? null,
      strength: r.strength ?? null, form: r.form, packSize: Number(r.pack_size), schedule: r.schedule,
      rxRequired: Boolean(r.rx_required), controlled: Boolean(r.controlled),
      therapeuticCategory: r.therapeutic_category ?? null, barcode: r.barcode ?? null,
      reorderLevel: Number(r.reorder_level), maxLevel: r.max_level == null ? null : Number(r.max_level),
      storage: r.storage, status: r.status,
      onHand: Number(r.on_hand), sellPrice: money(r.sell_price_minor, cur), costPrice: money(r.cost_price_minor, cur),
      stockValue: money(r.stock_value_minor, cur), currency: cur,
    };
  }

  async updateDrug(id: string, dto: UpdateDrugDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown) => {
        if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
      };
      set('generic_name', dto.genericName);
      set('brand', dto.brand);
      set('manufacturer', dto.manufacturer);
      set('strength', dto.strength);
      set('form', dto.form);
      set('pack_size', dto.packSize);
      set('schedule', dto.schedule);
      set('rx_required', dto.rxRequired);
      set('controlled', dto.controlled);
      set('therapeutic_category', dto.therapeuticCategory);
      set('barcode', dto.barcode);
      set('reorder_level', dto.reorderLevel);
      set('max_level', dto.maxLevel);
      set('storage', dto.storage);
      set('status', dto.status);
      if (!sets.length) return this.getDrugInTx(m, id);
      const res = (await m.query(
        `UPDATE pharmacy_drug SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(id)} AND deleted_at IS NULL RETURNING id`,
        params,
      )) as Row[];
      if (!res[0]) throw new NotFoundException('Drug not found');
      return this.getDrugInTx(m, id);
    });
  }

  async deleteDrug(id: string) {
    return this.tenantTx.run(async (m) => {
      const res = (await m.query(
        `UPDATE pharmacy_drug SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      )) as Row[];
      if (!res[0]) throw new NotFoundException('Drug not found');
      return { id, deleted: true };
    });
  }

  // ── GL account map ────────────────────────────────────────────────────────────
  async getGlConfig() {
    return this.tenantTx.run((m) => this.glConfigInTx(m));
  }

  async glConfigInTx(m: Mgr) {
    const rows = (await m.query(
      `SELECT inventory_account_id, revenue_account_id, cogs_account_id, tax_account_id, discount_account_id,
              receivable_account_id, clearing_account_id, writeoff_account_id
       FROM pharmacy_gl_config WHERE deleted_at IS NULL LIMIT 1`,
    )) as Row[];
    const r = rows[0];
    return {
      inventoryAccountId: (r?.inventory_account_id as string) ?? null,
      revenueAccountId: (r?.revenue_account_id as string) ?? null,
      cogsAccountId: (r?.cogs_account_id as string) ?? null,
      taxAccountId: (r?.tax_account_id as string) ?? null,
      discountAccountId: (r?.discount_account_id as string) ?? null,
      receivableAccountId: (r?.receivable_account_id as string) ?? null,
      clearingAccountId: (r?.clearing_account_id as string) ?? null,
      writeoffAccountId: (r?.writeoff_account_id as string) ?? null,
    };
  }

  async setGlConfig(dto: Record<string, string | undefined>) {
    return this.tenantTx.run(async (m) => {
      const map: Array<[string, string | undefined]> = [
        ['inventory_account_id', dto.inventoryAccountId],
        ['revenue_account_id', dto.revenueAccountId],
        ['cogs_account_id', dto.cogsAccountId],
        ['tax_account_id', dto.taxAccountId],
        ['discount_account_id', dto.discountAccountId],
        ['receivable_account_id', dto.receivableAccountId],
        ['clearing_account_id', dto.clearingAccountId],
        ['writeoff_account_id', dto.writeoffAccountId],
      ];
      const exists = (await m.query(`SELECT id FROM pharmacy_gl_config WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
      if (exists[0]) {
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const [col, val] of map) if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
        if (sets.length) {
          await m.query(`UPDATE pharmacy_gl_config SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(exists[0].id)}`, params);
        }
      } else {
        const cols = map.map(([c]) => c);
        const params = map.map(([, v]) => v ?? null);
        await m.query(
          `INSERT INTO pharmacy_gl_config (tenant_id, ${cols.join(', ')})
           VALUES (current_setting('app.tenant_id')::uuid, ${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          params,
        );
      }
      return this.glConfigInTx(m);
    });
  }

  // ── Quantity-break price tiers (per product) ──────────────────────────────────
  async getPriceTiers(productId: string) {
    return this.tenantTx.run(async (m) => this.priceTiersInTx(m, productId));
  }

  async priceTiersInTx(m: Mgr, productId: string): Promise<PriceTier[]> {
    const rows = (await m.query(
      `SELECT min_qty, unit_price_minor FROM pharmacy_price_tier WHERE product_id=$1 AND deleted_at IS NULL ORDER BY min_qty ASC`,
      [productId],
    )) as Row[];
    return rows.map((r) => ({ minQty: Number(r.min_qty), unitPriceMinor: Number(r.unit_price_minor) }));
  }

  /** Replace the whole tier set for a product (idempotent). */
  async setPriceTiers(productId: string, tiers: PriceTier[]) {
    return this.tenantTx.run(async (m) => {
      const prod = (await m.query(`SELECT id FROM inventory_product WHERE id=$1 AND deleted_at IS NULL`, [productId])) as Row[];
      if (!prod[0]) throw new BadRequestException('Unknown product for this tenant');
      await m.query(`DELETE FROM pharmacy_price_tier WHERE product_id=$1`, [productId]);
      const sorted = [...tiers].filter((t) => t.minQty >= 1 && t.unitPriceMinor >= 0).sort((a, b) => a.minQty - b.minQty);
      for (const t of sorted) {
        await m.query(
          `INSERT INTO pharmacy_price_tier (tenant_id, product_id, min_qty, unit_price_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3)`,
          [productId, t.minQty, t.unitPriceMinor],
        );
      }
      return this.priceTiersInTx(m, productId);
    });
  }

  private mapDrugList(r: Row) {
    const cur = r.currency as string;
    return {
      id: r.id, productId: r.product_id, sku: r.sku, name: r.name,
      genericName: r.generic_name ?? null, brand: r.brand ?? null, strength: r.strength ?? null,
      form: r.form, schedule: r.schedule, rxRequired: Boolean(r.rx_required), controlled: Boolean(r.controlled),
      reorderLevel: Number(r.reorder_level), onHand: Number(r.on_hand),
      sellPrice: money(r.sell_price_minor, cur), costPrice: money(r.cost_price_minor, cur),
      belowReorder: Number(r.on_hand) <= Number(r.reorder_level) && Number(r.reorder_level) > 0,
      status: r.status,
    };
  }
}
