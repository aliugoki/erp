import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type {
  AttachModifierGroupDto,
  CreateMenuCategoryDto,
  CreateMenuItemDto,
  CreateModifierDto,
  CreateModifierGroupDto,
  ListMenuItemsQueryDto,
  SetComboComponentsDto,
  SetItemBranchPriceDto,
  SetRestaurantConfigDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
} from './dto/restaurant.dto';
import { type Row, money, resolveMenuPrice, rowsOf } from './restaurant.util';
import { isValidEan13 } from '../codes/barcode.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isForeignKey = (e: unknown) => code(e) === '23503';
const isUnique = (e: unknown) => code(e) === '23505';
const TENANT = `current_setting('app.tenant_id')::uuid`;

/**
 * Menu catalogue + per-branch restaurant configuration. All writes are tenant-scoped through the
 * tenant transaction (RLS). A menu item may link to an `inventory_product` (enabling the Phase-2.2
 * recipe→COGS bridge) but never owns stock. Money is integer minor units.
 */
@Injectable()
export class RestaurantMenuService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  // ── Per-branch configuration ────────────────────────────────────────────────────
  async getConfig(branchId?: string) {
    return this.tenantTx.run((m) => this.readConfig(m, branchId));
  }

  private async readConfig(m: Mgr, branchId?: string) {
    const rows = (await m.query(
      `SELECT branch_id, service_model, channels, default_warehouse_id, currency, default_tax_bp,
              service_charge_bp, buffet_price_minor, auto_fire_kitchen, tip_enabled, rounding_enabled, timezone,
              auto_print_kot, auto_print_bill, receipt_header, receipt_footer, receipt_show_qr, tax_number
       FROM restaurant_config
       WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [branchId ?? null],
    )) as Row[];
    const r = rows[0];
    return {
      branchId: (r?.branch_id as string) ?? null,
      serviceModel: (r?.service_model as string) ?? 'DINE_IN',
      channels: (r?.channels as string[]) ?? ['DINE_IN'],
      defaultWarehouseId: (r?.default_warehouse_id as string) ?? null,
      currency: (r?.currency as string) ?? 'PKR',
      defaultTaxBp: r ? Number(r.default_tax_bp) : 0,
      serviceChargeBp: r ? Number(r.service_charge_bp) : 0,
      buffetPrice: r?.buffet_price_minor == null ? null : money(r.buffet_price_minor, (r?.currency as string) ?? 'PKR'),
      autoFireKitchen: r ? Boolean(r.auto_fire_kitchen) : true,
      tipEnabled: r ? Boolean(r.tip_enabled) : true,
      roundingEnabled: r ? Boolean(r.rounding_enabled) : true,
      timezone: (r?.timezone as string) ?? 'Asia/Karachi',
      autoPrintKot: r ? Boolean(r.auto_print_kot) : true,
      autoPrintBill: r ? Boolean(r.auto_print_bill) : false,
      receiptHeader: (r?.receipt_header as string) ?? null,
      receiptFooter: (r?.receipt_footer as string) ?? null,
      receiptShowQr: r ? Boolean(r.receipt_show_qr) : true,
      taxNumber: (r?.tax_number as string) ?? null,
    };
  }

  async setConfig(dto: SetRestaurantConfigDto) {
    return this.tenantTx.run(async (m) => {
      const exists = (await m.query(
        `SELECT id FROM restaurant_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
        [dto.branchId ?? null],
      )) as Row[];
      if (exists[0]) {
        const sets: string[] = [];
        const params: unknown[] = [];
        const set = (col: string, val: unknown) => {
          if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
        };
        set('service_model', dto.serviceModel);
        set('channels', dto.channels);
        set('default_warehouse_id', dto.defaultWarehouseId);
        set('currency', dto.currency);
        set('default_tax_bp', dto.defaultTaxBp);
        set('service_charge_bp', dto.serviceChargeBp);
        set('buffet_price_minor', dto.buffetPriceMinor);
        set('auto_fire_kitchen', dto.autoFireKitchen);
        set('tip_enabled', dto.tipEnabled);
        set('rounding_enabled', dto.roundingEnabled);
        set('timezone', dto.timezone);
        set('auto_print_kot', dto.autoPrintKot);
        set('auto_print_bill', dto.autoPrintBill);
        set('receipt_header', dto.receiptHeader);
        set('receipt_footer', dto.receiptFooter);
        set('receipt_show_qr', dto.receiptShowQr);
        set('tax_number', dto.taxNumber);
        if (sets.length) {
          await m.query(`UPDATE restaurant_config SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(exists[0].id)}`, params);
        }
      } else {
        await m.query(
          `INSERT INTO restaurant_config
             (tenant_id, branch_id, service_model, channels, default_warehouse_id, currency, default_tax_bp,
              service_charge_bp, buffet_price_minor, auto_fire_kitchen, tip_enabled, rounding_enabled, timezone,
              auto_print_kot, auto_print_bill, receipt_header, receipt_footer, receipt_show_qr, tax_number)
           VALUES (${TENANT}, $1, COALESCE($2,'DINE_IN'), COALESCE($3, ARRAY['DINE_IN']::text[]), $4, COALESCE($5,'PKR'),
                   COALESCE($6,0), COALESCE($7,0), $8, COALESCE($9,true), COALESCE($10,true), COALESCE($11,true), COALESCE($12,'Asia/Karachi'),
                   COALESCE($13,true), COALESCE($14,false), $15, $16, COALESCE($17,true), $18)`,
          [
            dto.branchId ?? null, dto.serviceModel ?? null, dto.channels ?? null, dto.defaultWarehouseId ?? null,
            dto.currency ?? null, dto.defaultTaxBp ?? null, dto.serviceChargeBp ?? null, dto.buffetPriceMinor ?? null,
            dto.autoFireKitchen ?? null, dto.tipEnabled ?? null, dto.roundingEnabled ?? null, dto.timezone ?? null,
            dto.autoPrintKot ?? null, dto.autoPrintBill ?? null, dto.receiptHeader ?? null, dto.receiptFooter ?? null,
            dto.receiptShowQr ?? null, dto.taxNumber ?? null,
          ],
        );
      }
      return this.readConfig(m, dto.branchId);
    });
  }

  // ── Multi-branch: listing + config bootstrap ────────────────────────────────────
  /**
   * The tenant's branches (from the shared `branch` table, RLS-scoped) annotated with whether each
   * already has a `restaurant_config` row. Drives the branch switcher in the apps + web workspace.
   */
  async listBranches() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT b.id, b.name, b.code, b.is_head_office, b.active,
                (rc.id IS NOT NULL) AS configured
         FROM branch b
         LEFT JOIN restaurant_config rc ON rc.branch_id = b.id AND rc.deleted_at IS NULL
         WHERE b.deleted_at IS NULL
         ORDER BY b.is_head_office DESC, b.name`,
      )) as Row[];
      return rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        code: (r.code as string) ?? null,
        isHeadOffice: Boolean(r.is_head_office),
        active: Boolean(r.active),
        configured: Boolean(r.configured),
      }));
    });
  }

  /**
   * Ensure a branch has a `restaurant_config` row, cloning the head-office (or legacy null-branch)
   * config's warehouse/currency/tax so a freshly-created outlet can take correctly-priced orders
   * immediately instead of silently falling back to 0-tax + null-warehouse. No-op for the null
   * (single-branch/default) branch and for branches already configured. Runs inside the caller's tx.
   */
  async ensureConfigForBranch(m: Mgr, branchId: string | null): Promise<void> {
    if (!branchId) return;
    const exists = (await m.query(
      `SELECT id FROM restaurant_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [branchId],
    )) as Row[];
    if (exists[0]) return;
    // Template: prefer the head-office branch's config, then the legacy null-branch config, then any config.
    const tpl = (await m.query(
      `SELECT c.service_model, c.channels, c.default_warehouse_id, c.currency, c.default_tax_bp,
              c.service_charge_bp, c.buffet_price_minor, c.auto_fire_kitchen, c.tip_enabled,
              c.rounding_enabled, c.timezone, c.auto_print_kot, c.auto_print_bill,
              c.receipt_header, c.receipt_footer, c.receipt_show_qr, c.tax_number
       FROM restaurant_config c
       LEFT JOIN branch b ON b.id = c.branch_id AND b.deleted_at IS NULL
       WHERE c.deleted_at IS NULL
       ORDER BY COALESCE(b.is_head_office, false) DESC, (c.branch_id IS NULL) DESC
       LIMIT 1`,
    )) as Row[];
    const t = tpl[0];
    await m.query(
      `INSERT INTO restaurant_config
         (tenant_id, branch_id, service_model, channels, default_warehouse_id, currency, default_tax_bp,
          service_charge_bp, buffet_price_minor, auto_fire_kitchen, tip_enabled, rounding_enabled, timezone,
          auto_print_kot, auto_print_bill, receipt_header, receipt_footer, receipt_show_qr, tax_number)
       VALUES (${TENANT}, $1, COALESCE($2,'DINE_IN'), COALESCE($3, ARRAY['DINE_IN']::text[]), $4, COALESCE($5,'PKR'),
               COALESCE($6,0), COALESCE($7,0), $8, COALESCE($9,true), COALESCE($10,true), COALESCE($11,true), COALESCE($12,'Asia/Karachi'),
               COALESCE($13,true), COALESCE($14,false), $15, $16, COALESCE($17,true), $18)`,
      [
        branchId, t?.service_model ?? null, t?.channels ?? null, t?.default_warehouse_id ?? null,
        t?.currency ?? null, t?.default_tax_bp ?? null, t?.service_charge_bp ?? null, t?.buffet_price_minor ?? null,
        t?.auto_fire_kitchen ?? null, t?.tip_enabled ?? null, t?.rounding_enabled ?? null, t?.timezone ?? null,
        t?.auto_print_kot ?? null, t?.auto_print_bill ?? null, t?.receipt_header ?? null, t?.receipt_footer ?? null,
        t?.receipt_show_qr ?? null, t?.tax_number ?? null,
      ],
    );
  }

  /** Validate a branch belongs to the tenant, then bootstrap its restaurant config. */
  async provisionBranch(branchId: string) {
    return this.tenantTx.run(async (m) => {
      const b = (await m.query(`SELECT id FROM branch WHERE id=$1 AND deleted_at IS NULL`, [branchId])) as Row[];
      if (!b[0]) throw new NotFoundException('Unknown branch for this tenant');
      await this.ensureConfigForBranch(m, branchId);
      return this.readConfig(m, branchId);
    });
  }

  // ── Categories ──────────────────────────────────────────────────────────────────
  async createCategory(dto: CreateMenuCategoryDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO restaurant_menu_category (tenant_id, name, parent_id, sort_order, active, image_key)
           VALUES (${TENANT}, $1, $2, COALESCE($3,0), COALESCE($4,true), $5) RETURNING id`,
          [dto.name, dto.parentId ?? null, dto.sortOrder ?? null, dto.active ?? null, dto.imageKey ?? null],
        )) as Row[];
        return this.getCategoryInTx(m, rows[0]!.id as string);
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown parent category for this tenant');
        throw err;
      }
    });
  }

  async listCategories() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT c.id, c.name, c.parent_id, c.sort_order, c.active, c.image_key,
                count(i.id) FILTER (WHERE i.deleted_at IS NULL)::int AS item_count
         FROM restaurant_menu_category c
         LEFT JOIN restaurant_menu_item i ON i.category_id = c.id
         WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY c.sort_order, c.name`,
      )) as Row[];
      return rows.map((r) => ({
        id: r.id, name: r.name, parentId: r.parent_id ?? null, sortOrder: Number(r.sort_order),
        active: Boolean(r.active), imageKey: r.image_key ?? null, itemCount: Number(r.item_count),
      }));
    });
  }

  private async getCategoryInTx(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT id, name, parent_id, sort_order, active, image_key FROM restaurant_menu_category WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Category not found');
    const r = rows[0];
    return { id: r.id, name: r.name, parentId: r.parent_id ?? null, sortOrder: Number(r.sort_order), active: Boolean(r.active), imageKey: r.image_key ?? null };
  }

  async updateCategory(id: string, dto: UpdateMenuCategoryDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown) => {
        if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
      };
      set('name', dto.name);
      set('parent_id', dto.parentId);
      set('sort_order', dto.sortOrder);
      set('active', dto.active);
      set('image_key', dto.imageKey);
      if (!sets.length) return this.getCategoryInTx(m, id);
      const res = rowsOf(await m.query(
        `UPDATE restaurant_menu_category SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(id)} AND deleted_at IS NULL RETURNING id`,
        params,
      ));
      if (!res[0]) throw new NotFoundException('Category not found');
      return this.getCategoryInTx(m, id);
    });
  }

  async deleteCategory(id: string) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_menu_category SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      ));
      if (!res[0]) throw new NotFoundException('Category not found');
      return { id, deleted: true };
    });
  }

  /**
   * A 13-digit barcode is meant to be an EAN — reject a bad check digit here, not at the till. Any
   * other shape (a UPC-A, an EAN-8, an internal alphanumeric SKU) passes through untouched.
   */
  private assertBarcode(barcode: string | undefined) {
    if (barcode && /^\d{13}$/.test(barcode.trim()) && !isValidEan13(barcode.trim())) {
      throw new BadRequestException(`"${barcode}" has an invalid EAN-13 check digit`);
    }
  }

  // ── Items ─────────────────────────────────────────────────────────────────────--
  async createItem(dto: CreateMenuItemDto) {
    return this.tenantTx.run(async (m) => {
      if (dto.productId) await this.assertProduct(m, dto.productId);
      this.assertBarcode(dto.barcode);
      try {
        const rows = (await m.query(
          `INSERT INTO restaurant_menu_item
             (tenant_id, category_id, product_id, sku, barcode, name, description, base_price_minor, currency, tax_bp,
              prep_minutes, station_key, calories, allergens, tags, image_key, video_key, is_combo, available)
           VALUES (${TENANT}, $1,$2,$3,$4,$5,$6, COALESCE($7,0), COALESCE($8,'PKR'), $9, COALESCE($10,0), $11, $12,
                   COALESCE($13, ARRAY[]::text[]), COALESCE($14, ARRAY[]::text[]), $15, $16, COALESCE($17,false), COALESCE($18,true))
           RETURNING id`,
          [
            dto.categoryId ?? null, dto.productId ?? null, dto.sku ?? null, dto.barcode ?? null, dto.name, dto.description ?? null,
            dto.basePriceMinor ?? null, dto.currency ?? null, dto.taxBp ?? null, dto.prepMinutes ?? null,
            dto.stationKey ?? null, dto.calories ?? null, dto.allergens ?? null, dto.tags ?? null,
            dto.imageKey ?? null, dto.videoKey ?? null, dto.isCombo ?? null, dto.available ?? null,
          ],
        )) as Row[];
        return this.getItemInTx(m, rows[0]!.id as string);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Barcode "${dto.barcode}" is already used by another item`);
        if (isForeignKey(err)) throw new BadRequestException('Unknown category or product for this tenant');
        throw err;
      }
    });
  }

  async listItems(query: ListMenuItemsQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['i.deleted_at IS NULL'];
      const params: unknown[] = [query.branchId ?? null];
      if (query.q) {
        const idx = params.push(`%${query.q.toLowerCase()}%`);
        conds.push(`(lower(i.name) LIKE $${idx} OR lower(i.sku) LIKE $${idx} OR lower(i.barcode) LIKE $${idx})`);
      }
      if (query.categoryId) conds.push(`i.category_id = $${params.push(query.categoryId)}`);
      if (query.available) conds.push(`i.available = $${params.push(query.available === 'true')}`);
      const rows = (await m.query(
        `SELECT i.id, i.category_id, c.name AS category, i.product_id, i.sku, i.barcode, i.name, i.base_price_minor,
                i.currency, i.tax_bp, i.prep_minutes, i.station_key, i.is_combo, i.available, i.status, i.image_key,
                b.price_minor AS branch_price_minor, b.available AS branch_available
         FROM restaurant_menu_item i
         LEFT JOIN restaurant_menu_category c ON c.id = i.category_id
         LEFT JOIN restaurant_menu_item_branch b ON b.item_id = i.id AND b.branch_id IS NOT DISTINCT FROM $1
         WHERE ${conds.join(' AND ')} ORDER BY i.name`,
        params,
      )) as Row[];
      return rows.map((r) => this.mapItemList(r));
    });
  }

  async getItem(id: string, branchId?: string) {
    return this.tenantTx.run((m) => this.getItemInTx(m, id, branchId));
  }

  private async getItemInTx(m: Mgr, id: string, branchId?: string) {
    const rows = (await m.query(
      `SELECT i.id, i.category_id, c.name AS category, i.product_id, i.sku, i.barcode, i.name, i.description,
              i.base_price_minor, i.currency, i.tax_bp, i.prep_minutes, i.station_key, i.calories,
              i.allergens, i.tags, i.image_key, i.video_key, i.is_combo, i.available, i.status,
              b.price_minor AS branch_price_minor, b.available AS branch_available
       FROM restaurant_menu_item i
       LEFT JOIN restaurant_menu_category c ON c.id = i.category_id
       LEFT JOIN restaurant_menu_item_branch b ON b.item_id = i.id AND b.branch_id IS NOT DISTINCT FROM $2
       WHERE i.id=$1 AND i.deleted_at IS NULL`,
      [id, branchId ?? null],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Menu item not found');
    const r = rows[0];
    const cur = r.currency as string;
    const groups = (await m.query(
      `SELECT g.id, g.name, g.min_select, g.max_select, g.required, x.sort_order
       FROM restaurant_item_modifier_group x JOIN restaurant_modifier_group g ON g.id = x.group_id
       WHERE x.item_id=$1 AND x.deleted_at IS NULL AND g.deleted_at IS NULL ORDER BY x.sort_order`,
      [id],
    )) as Row[];
    const components = r.is_combo
      ? ((await m.query(
          `SELECT k.component_item_id, ci.name, k.qty, k.price_delta_minor
           FROM restaurant_combo_component k JOIN restaurant_menu_item ci ON ci.id = k.component_item_id
           WHERE k.combo_item_id=$1 AND k.deleted_at IS NULL ORDER BY k.created_at`,
          [id],
        )) as Row[])
      : [];
    const effectivePrice = resolveMenuPrice(Number(r.base_price_minor), r.branch_price_minor == null ? null : Number(r.branch_price_minor));
    return {
      id: r.id, categoryId: r.category_id ?? null, category: r.category ?? null, productId: r.product_id ?? null,
      sku: r.sku ?? null, barcode: r.barcode ?? null, name: r.name, description: r.description ?? null,
      basePrice: money(r.base_price_minor, cur), effectivePrice: money(effectivePrice, cur), currency: cur,
      taxBp: r.tax_bp == null ? null : Number(r.tax_bp), prepMinutes: Number(r.prep_minutes),
      stationKey: r.station_key ?? null, calories: r.calories == null ? null : Number(r.calories),
      allergens: (r.allergens as string[]) ?? [], tags: (r.tags as string[]) ?? [],
      imageKey: r.image_key ?? null, videoKey: r.video_key ?? null,
      isCombo: Boolean(r.is_combo), available: Boolean(r.available) && (r.branch_available == null || Boolean(r.branch_available)),
      status: r.status,
      modifierGroups: groups.map((g) => ({ id: g.id, name: g.name, minSelect: Number(g.min_select), maxSelect: g.max_select == null ? null : Number(g.max_select), required: Boolean(g.required), sortOrder: Number(g.sort_order) })),
      comboComponents: components.map((k) => ({ componentItemId: k.component_item_id, name: k.name, qty: Number(k.qty), priceDelta: money(k.price_delta_minor, cur) })),
    };
  }

  async updateItem(id: string, dto: UpdateMenuItemDto) {
    return this.tenantTx.run(async (m) => {
      if (dto.productId) await this.assertProduct(m, dto.productId);
      this.assertBarcode(dto.barcode);
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown) => {
        if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
      };
      set('category_id', dto.categoryId);
      set('product_id', dto.productId);
      set('sku', dto.sku);
      set('barcode', dto.barcode);
      set('name', dto.name);
      set('description', dto.description);
      set('base_price_minor', dto.basePriceMinor);
      set('currency', dto.currency);
      set('tax_bp', dto.taxBp);
      set('prep_minutes', dto.prepMinutes);
      set('station_key', dto.stationKey);
      set('calories', dto.calories);
      set('allergens', dto.allergens);
      set('tags', dto.tags);
      set('image_key', dto.imageKey);
      set('video_key', dto.videoKey);
      set('available', dto.available);
      set('status', dto.status);
      if (!sets.length) return this.getItemInTx(m, id);
      try {
        const res = rowsOf(await m.query(
          `UPDATE restaurant_menu_item SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(id)} AND deleted_at IS NULL RETURNING id`,
          params,
        ));
        if (!res[0]) throw new NotFoundException('Menu item not found');
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Barcode "${dto.barcode}" is already used by another item`);
        if (isForeignKey(err)) throw new BadRequestException('Unknown category or product for this tenant');
        throw err;
      }
      return this.getItemInTx(m, id);
    });
  }

  async deleteItem(id: string) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_menu_item SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      ));
      if (!res[0]) throw new NotFoundException('Menu item not found');
      return { id, deleted: true };
    });
  }

  /** Set (upsert) a per-branch price / availability override for an item. */
  async setBranchPrice(itemId: string, dto: SetItemBranchPriceDto) {
    return this.tenantTx.run(async (m) => {
      await this.assertItem(m, itemId);
      const existing = (await m.query(
        `SELECT id FROM restaurant_menu_item_branch WHERE item_id=$1 AND branch_id=$2 AND deleted_at IS NULL`,
        [itemId, dto.branchId],
      )) as Row[];
      if (existing[0]) {
        await m.query(
          `UPDATE restaurant_menu_item_branch SET price_minor=$1, available=COALESCE($2,true), updated_at=now() WHERE id=$3`,
          [dto.priceMinor ?? null, dto.available ?? null, existing[0].id],
        );
      } else {
        await m.query(
          `INSERT INTO restaurant_menu_item_branch (tenant_id, item_id, branch_id, price_minor, available)
           VALUES (${TENANT}, $1,$2,$3, COALESCE($4,true))`,
          [itemId, dto.branchId, dto.priceMinor ?? null, dto.available ?? null],
        );
      }
      return this.getItemInTx(m, itemId, dto.branchId);
    });
  }

  // ── Modifier groups + modifiers ───────────────────────────────────────────────--
  async createModifierGroup(dto: CreateModifierGroupDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO restaurant_modifier_group (tenant_id, name, min_select, max_select, required, sort_order)
         VALUES (${TENANT}, $1, COALESCE($2,0), $3, COALESCE($4,false), COALESCE($5,0)) RETURNING id`,
        [dto.name, dto.minSelect ?? null, dto.maxSelect ?? null, dto.required ?? null, dto.sortOrder ?? null],
      )) as Row[];
      return this.getModifierGroupInTx(m, rows[0]!.id as string);
    });
  }

  async listModifierGroups() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT g.id, g.name, g.min_select, g.max_select, g.required, g.sort_order,
                count(mo.id) FILTER (WHERE mo.deleted_at IS NULL)::int AS modifier_count
         FROM restaurant_modifier_group g LEFT JOIN restaurant_modifier mo ON mo.group_id = g.id
         WHERE g.deleted_at IS NULL GROUP BY g.id ORDER BY g.sort_order, g.name`,
      )) as Row[];
      return rows.map((g) => ({ id: g.id, name: g.name, minSelect: Number(g.min_select), maxSelect: g.max_select == null ? null : Number(g.max_select), required: Boolean(g.required), sortOrder: Number(g.sort_order), modifierCount: Number(g.modifier_count) }));
    });
  }

  private async getModifierGroupInTx(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT id, name, min_select, max_select, required, sort_order FROM restaurant_modifier_group WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Modifier group not found');
    const g = rows[0];
    const mods = (await m.query(
      `SELECT id, name, price_delta_minor, product_id, sort_order, available FROM restaurant_modifier
       WHERE group_id=$1 AND deleted_at IS NULL ORDER BY sort_order, name`,
      [id],
    )) as Row[];
    return {
      id: g.id, name: g.name, minSelect: Number(g.min_select), maxSelect: g.max_select == null ? null : Number(g.max_select),
      required: Boolean(g.required), sortOrder: Number(g.sort_order),
      modifiers: mods.map((mo) => ({ id: mo.id, name: mo.name, priceDelta: money(mo.price_delta_minor), productId: mo.product_id ?? null, sortOrder: Number(mo.sort_order), available: Boolean(mo.available) })),
    };
  }

  async getModifierGroup(id: string) {
    return this.tenantTx.run((m) => this.getModifierGroupInTx(m, id));
  }

  async updateModifierGroup(id: string, dto: UpdateModifierGroupDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown) => {
        if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
      };
      set('name', dto.name);
      set('min_select', dto.minSelect);
      set('max_select', dto.maxSelect);
      set('required', dto.required);
      set('sort_order', dto.sortOrder);
      if (sets.length) {
        const res = rowsOf(await m.query(
          `UPDATE restaurant_modifier_group SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(id)} AND deleted_at IS NULL RETURNING id`,
          params,
        ));
        if (!res[0]) throw new NotFoundException('Modifier group not found');
      }
      return this.getModifierGroupInTx(m, id);
    });
  }

  async deleteModifierGroup(id: string) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_modifier_group SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      ));
      if (!res[0]) throw new NotFoundException('Modifier group not found');
      return { id, deleted: true };
    });
  }

  async createModifier(dto: CreateModifierDto) {
    return this.tenantTx.run(async (m) => {
      if (dto.productId) await this.assertProduct(m, dto.productId);
      try {
        await m.query(
          `INSERT INTO restaurant_modifier (tenant_id, group_id, name, price_delta_minor, product_id, sort_order, available)
           VALUES (${TENANT}, $1,$2, COALESCE($3,0), $4, COALESCE($5,0), COALESCE($6,true))`,
          [dto.groupId, dto.name, dto.priceDeltaMinor ?? null, dto.productId ?? null, dto.sortOrder ?? null, dto.available ?? null],
        );
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown modifier group or product for this tenant');
        throw err;
      }
      return this.getModifierGroupInTx(m, dto.groupId);
    });
  }

  async updateModifier(id: string, dto: UpdateModifierDto) {
    return this.tenantTx.run(async (m) => {
      if (dto.productId) await this.assertProduct(m, dto.productId);
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown) => {
        if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
      };
      set('name', dto.name);
      set('price_delta_minor', dto.priceDeltaMinor);
      set('product_id', dto.productId);
      set('sort_order', dto.sortOrder);
      set('available', dto.available);
      if (!sets.length) throw new BadRequestException('Nothing to update');
      const res = rowsOf(await m.query(
        `UPDATE restaurant_modifier SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(id)} AND deleted_at IS NULL RETURNING group_id`,
        params,
      ));
      if (!res[0]) throw new NotFoundException('Modifier not found');
      return this.getModifierGroupInTx(m, res[0].group_id as string);
    });
  }

  async deleteModifier(id: string) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_modifier SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      ));
      if (!res[0]) throw new NotFoundException('Modifier not found');
      return { id, deleted: true };
    });
  }

  /** Attach a modifier group to an item (idempotent per (item, group)). */
  async attachModifierGroup(itemId: string, dto: AttachModifierGroupDto) {
    return this.tenantTx.run(async (m) => {
      await this.assertItem(m, itemId);
      try {
        await m.query(
          `INSERT INTO restaurant_item_modifier_group (tenant_id, item_id, group_id, sort_order)
           VALUES (${TENANT}, $1,$2, COALESCE($3,0))
           ON CONFLICT (tenant_id, item_id, group_id) DO UPDATE SET sort_order = EXCLUDED.sort_order, deleted_at = NULL, updated_at = now()`,
          [itemId, dto.groupId, dto.sortOrder ?? null],
        );
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown item or modifier group for this tenant');
        throw err;
      }
      return this.getItemInTx(m, itemId);
    });
  }

  async detachModifierGroup(itemId: string, groupId: string) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `DELETE FROM restaurant_item_modifier_group WHERE item_id=$1 AND group_id=$2 RETURNING id`,
        [itemId, groupId],
      ));
      if (!res[0]) throw new NotFoundException('Attachment not found');
      return { itemId, groupId, detached: true };
    });
  }

  // ── Combos ────────────────────────────────────────────────────────────────────--
  /** Replace the whole component set of a combo item (marks it is_combo=true). */
  async setComboComponents(comboItemId: string, dto: SetComboComponentsDto) {
    return this.tenantTx.run(async (m) => {
      await this.assertItem(m, comboItemId);
      await m.query(`DELETE FROM restaurant_combo_component WHERE combo_item_id=$1`, [comboItemId]);
      for (const c of dto.components) {
        if (c.componentItemId === comboItemId) throw new BadRequestException('A combo cannot contain itself');
        try {
          await m.query(
            `INSERT INTO restaurant_combo_component (tenant_id, combo_item_id, component_item_id, qty, price_delta_minor)
             VALUES (${TENANT}, $1,$2, COALESCE($3,1), COALESCE($4,0))`,
            [comboItemId, c.componentItemId, c.qty ?? null, c.priceDeltaMinor ?? null],
          );
        } catch (err) {
          if (isForeignKey(err)) throw new BadRequestException('One or more component items do not exist in this tenant');
          throw err;
        }
      }
      await m.query(`UPDATE restaurant_menu_item SET is_combo=true, updated_at=now() WHERE id=$1`, [comboItemId]);
      return this.getItemInTx(m, comboItemId);
    });
  }

  // ── shared guards ────────────────────────────────────────────────────────────--
  private async assertProduct(m: Mgr, productId: string) {
    const rows = (await m.query(`SELECT id FROM inventory_product WHERE id=$1 AND deleted_at IS NULL`, [productId])) as Row[];
    if (!rows[0]) throw new BadRequestException('Unknown product for this tenant');
  }

  private async assertItem(m: Mgr, itemId: string) {
    const rows = (await m.query(`SELECT id FROM restaurant_menu_item WHERE id=$1 AND deleted_at IS NULL`, [itemId])) as Row[];
    if (!rows[0]) throw new NotFoundException('Menu item not found');
  }

  private mapItemList(r: Row) {
    const cur = r.currency as string;
    const effectivePrice = resolveMenuPrice(Number(r.base_price_minor), r.branch_price_minor == null ? null : Number(r.branch_price_minor));
    return {
      id: r.id, categoryId: r.category_id ?? null, category: r.category ?? null, productId: r.product_id ?? null,
      sku: r.sku ?? null, barcode: r.barcode ?? null, name: r.name, basePrice: money(r.base_price_minor, cur), effectivePrice: money(effectivePrice, cur),
      currency: cur, taxBp: r.tax_bp == null ? null : Number(r.tax_bp), prepMinutes: Number(r.prep_minutes),
      stationKey: r.station_key ?? null, isCombo: Boolean(r.is_combo), imageKey: r.image_key ?? null,
      available: Boolean(r.available) && (r.branch_available == null || Boolean(r.branch_available)), status: r.status,
    };
  }
}
