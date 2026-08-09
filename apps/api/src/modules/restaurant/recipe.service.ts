import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { SetRecipeDto } from './dto/restaurant.dto';
import { type Row, money, rowsOf } from './restaurant.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
const TENANT = `current_setting('app.tenant_id')::uuid`;

/**
 * Recipes: a menu item's bill of materials of `inventory_product`s (qty per yield + waste). This is the
 * bridge that lets settlement (Phase 4.2) decrement the shared valued inventory ledger and capture
 * weighted-average COGS — the RMS never owns stock. Tenant-scoped (RLS); quantities in milli-units.
 */
@Injectable()
export class RestaurantRecipeService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  async list() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT r.id, r.item_id, mi.name AS item_name, r.yield_qty, r.status,
                count(ri.id) FILTER (WHERE ri.deleted_at IS NULL)::int AS ingredient_count
         FROM restaurant_recipe r JOIN restaurant_menu_item mi ON mi.id = r.item_id
         LEFT JOIN restaurant_recipe_ingredient ri ON ri.recipe_id = r.id
         WHERE r.deleted_at IS NULL GROUP BY r.id, mi.name ORDER BY mi.name`,
      )) as Row[];
      return rows.map((r) => ({ id: r.id, itemId: r.item_id, itemName: r.item_name, yieldQty: Number(r.yield_qty), status: r.status, ingredientCount: Number(r.ingredient_count) }));
    });
  }

  async getForItem(itemId: string) {
    return this.tenantTx.run((m) => this.readInTx(m, itemId));
  }

  private async readInTx(m: Mgr, itemId: string) {
    const rows = (await m.query(
      `SELECT r.id, r.item_id, mi.name AS item_name, r.yield_qty, r.instructions, r.status
       FROM restaurant_recipe r JOIN restaurant_menu_item mi ON mi.id = r.item_id
       WHERE r.item_id=$1 AND r.deleted_at IS NULL`,
      [itemId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Recipe not found for this item');
    const r = rows[0];
    const ings = (await m.query(
      `SELECT ri.id, ri.product_id, p.sku, p.name, ri.qty_per_yield_milli, ri.unit, ri.waste_bp,
              p.cost_price_minor, p.currency
       FROM restaurant_recipe_ingredient ri JOIN inventory_product p ON p.id = ri.product_id
       WHERE ri.recipe_id=$1 AND ri.deleted_at IS NULL ORDER BY p.name`,
      [r.id],
    )) as Row[];
    return {
      id: r.id, itemId: r.item_id, itemName: r.item_name, yieldQty: Number(r.yield_qty),
      instructions: r.instructions ?? null, status: r.status,
      ingredients: ings.map((i) => ({
        id: i.id, productId: i.product_id, sku: i.sku, name: i.name,
        qtyPerYieldMilli: Number(i.qty_per_yield_milli), unit: i.unit ?? null, wasteBp: Number(i.waste_bp),
        unitCost: money(i.cost_price_minor, i.currency as string),
      })),
    };
  }

  /** Upsert a menu item's recipe and replace its ingredient list (idempotent). */
  async setForItem(itemId: string, dto: SetRecipeDto) {
    return this.tenantTx.run(async (m) => {
      const item = (await m.query(`SELECT id FROM restaurant_menu_item WHERE id=$1 AND deleted_at IS NULL`, [itemId])) as Row[];
      if (!item[0]) throw new NotFoundException('Menu item not found');

      const existing = (await m.query(`SELECT id FROM restaurant_recipe WHERE item_id=$1 AND deleted_at IS NULL`, [itemId])) as Row[];
      let recipeId: string;
      if (existing[0]) {
        recipeId = existing[0].id as string;
        await m.query(
          `UPDATE restaurant_recipe SET yield_qty=COALESCE($2,yield_qty), instructions=$3, updated_at=now() WHERE id=$1`,
          [recipeId, dto.yieldQty ?? null, dto.instructions ?? null],
        );
        await m.query(`DELETE FROM restaurant_recipe_ingredient WHERE recipe_id=$1`, [recipeId]);
      } else {
        const created = (await m.query(
          `INSERT INTO restaurant_recipe (tenant_id, item_id, yield_qty, instructions, status)
           VALUES (${TENANT}, $1, COALESCE($2,1), $3, 'ACTIVE') RETURNING id`,
          [itemId, dto.yieldQty ?? null, dto.instructions ?? null],
        )) as Row[];
        recipeId = created[0]!.id as string;
      }
      for (const ing of dto.ingredients) {
        try {
          await m.query(
            `INSERT INTO restaurant_recipe_ingredient (tenant_id, recipe_id, product_id, qty_per_yield_milli, unit, waste_bp)
             VALUES (${TENANT}, $1,$2,$3,$4, COALESCE($5,0))`,
            [recipeId, ing.productId, ing.qtyPerYieldMilli, ing.unit ?? null, ing.wasteBp ?? null],
          );
        } catch (err) {
          if (isFk(err)) throw new BadRequestException('One or more ingredient products do not exist in this tenant');
          throw err;
        }
      }
      return this.readInTx(m, itemId);
    });
  }

  async deleteForItem(itemId: string) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_recipe SET deleted_at=now(), updated_at=now() WHERE item_id=$1 AND deleted_at IS NULL RETURNING id`,
        [itemId],
      ));
      if (!res[0]) throw new NotFoundException('Recipe not found for this item');
      return { itemId, deleted: true };
    });
  }
}
