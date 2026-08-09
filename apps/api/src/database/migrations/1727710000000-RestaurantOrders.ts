import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Restaurant vertical — Phase 2.2 operational schema (ADR-011). The order lifecycle and everything it
 * fans out to: the order + line items + chosen modifiers, kitchen stations and the KDS ticket state
 * machine, recipes (a menu item's bill of materials of inventory_product — the bridge that lets
 * settlement deduct the shared valued ledger and compute weighted-average COGS), payments/splits, and
 * own-delivery dispatch + tracking. Every money field is integer minor units; every table is
 * tenant-scoped (RLS). Order/KDS/tracking tables are indexed on (tenant_id, branch_id, created_at) so
 * they can be range-partitioned by month at the scale target (10k branches, 500k orders/day) without
 * schema change. Side-effects (GL post, inventory deduction, fiscal report) happen via the outbox +
 * idempotent consumers reacting to restaurant.bill.settled — never inline here.
 */
export class RestaurantOrders1727710000000 implements MigrationInterface {
  name = 'RestaurantOrders1727710000000';

  public async up(q: QueryRunner): Promise<void> {
    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fk = (t: string, col: string, parent: string, onDelete = 'RESTRICT') =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_${col}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "${parent}"("tenant_id","id") ON DELETE ${onDelete}`);
    const fkProduct = (t: string, col = 'product_id', onDelete = 'RESTRICT') =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_${col}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "inventory_product"("tenant_id","id") ON DELETE ${onDelete}`);

    // ── Kitchen stations (grill / fry / pizza / cold / bar / dessert / bakery) ─────
    await q.query(
      createTenantTableSql('restaurant_station', [
        '"branch_id" uuid',
        '"key" text NOT NULL',
        '"name" text NOT NULL',
        '"sort_order" integer NOT NULL DEFAULT 0',
        '"printer_target" text',
        '"active" boolean NOT NULL DEFAULT true',
      ]),
    );
    await uq('restaurant_station');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_station_key" ON "restaurant_station" ("tenant_id","branch_id","key") WHERE "deleted_at" IS NULL`);

    // ── Order (the guest tab: dine-in session / QSR ticket / delivery / drive-thru) ─
    await q.query(
      createTenantTableSql('restaurant_order', [
        '"branch_id" uuid',
        '"order_no" text NOT NULL',
        `"channel" text NOT NULL DEFAULT 'DINE_IN'`,
        '"table_id" uuid',
        '"customer_id" uuid',
        '"waiter_employee_id" uuid',
        '"guest_count" integer NOT NULL DEFAULT 1',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"subtotal_minor" bigint NOT NULL DEFAULT 0',
        '"discount_minor" bigint NOT NULL DEFAULT 0',
        '"service_charge_minor" bigint NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"tip_minor" bigint NOT NULL DEFAULT 0',
        '"rounding_minor" bigint NOT NULL DEFAULT 0',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"cogs_minor" bigint NOT NULL DEFAULT 0',
        '"paid_minor" bigint NOT NULL DEFAULT 0',
        // Fiscalization result stamped back by the fiscal consumer (dynamic authority — ADR-011 §7).
        '"fiscal_authority" text',
        '"fiscal_invoice_no" text',
        '"fiscal_qr" text',
        '"fiscal_status" text',
        '"placed_at" timestamptz',
        '"settled_at" timestamptz',
        '"notes" text',
      ]),
    );
    await uq('restaurant_order');
    await fk('restaurant_order', 'table_id', 'restaurant_table', 'SET NULL');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_order_no" ON "restaurant_order" ("tenant_id","order_no")`);
    await q.query(`CREATE INDEX "ix_restaurant_order_branch_created" ON "restaurant_order" ("tenant_id","branch_id","created_at")`);
    await q.query(`CREATE INDEX "ix_restaurant_order_status" ON "restaurant_order" ("tenant_id","branch_id","status")`);
    await q.query(`ALTER TABLE "restaurant_order" ADD CONSTRAINT "ck_restaurant_order_channel"
      CHECK ("channel" IN ('DINE_IN','TAKEAWAY','DELIVERY','DRIVE_THRU','AGGREGATOR'))`);
    await q.query(`ALTER TABLE "restaurant_order" ADD CONSTRAINT "ck_restaurant_order_status"
      CHECK ("status" IN ('DRAFT','PLACED','CONFIRMED','IN_PROGRESS','READY','SERVED','SETTLED','CLOSED','VOID','REFUNDED'))`);

    // ── Order items (with resolved unit price, course, kitchen notes) ─────────────
    await q.query(
      createTenantTableSql('restaurant_order_item', [
        '"order_id" uuid NOT NULL',
        '"item_id" uuid',
        '"product_id" uuid',
        '"name" text NOT NULL',
        '"station_key" text',
        '"qty" integer NOT NULL DEFAULT 1',
        '"course" integer NOT NULL DEFAULT 1',
        '"unit_price_minor" bigint NOT NULL DEFAULT 0',
        '"modifier_total_minor" bigint NOT NULL DEFAULT 0',
        '"discount_minor" bigint NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"line_total_minor" bigint NOT NULL DEFAULT 0',
        '"cogs_minor" bigint NOT NULL DEFAULT 0',
        `"status" text NOT NULL DEFAULT 'NEW'`,
        '"kitchen_notes" text',
      ]),
    );
    await uq('restaurant_order_item');
    await fk('restaurant_order_item', 'order_id', 'restaurant_order', 'CASCADE');
    await fk('restaurant_order_item', 'item_id', 'restaurant_menu_item', 'SET NULL');
    await q.query(`CREATE INDEX "ix_restaurant_order_item_order" ON "restaurant_order_item" ("tenant_id","order_id")`);
    await q.query(`ALTER TABLE "restaurant_order_item" ADD CONSTRAINT "ck_restaurant_order_item_status"
      CHECK ("status" IN ('NEW','FIRED','READY','SERVED','VOID'))`);

    // ── Chosen modifiers per order item (snapshot of name + price at order time) ──
    await q.query(
      createTenantTableSql('restaurant_order_item_modifier', [
        '"order_item_id" uuid NOT NULL',
        '"modifier_id" uuid',
        '"name" text NOT NULL',
        '"price_delta_minor" bigint NOT NULL DEFAULT 0',
        '"qty" integer NOT NULL DEFAULT 1',
      ]),
    );
    await uq('restaurant_order_item_modifier');
    await fk('restaurant_order_item_modifier', 'order_item_id', 'restaurant_order_item', 'CASCADE');

    // ── KDS tickets (one per station per order) + ticket items ────────────────────
    await q.query(
      createTenantTableSql('restaurant_kds_ticket', [
        '"order_id" uuid NOT NULL',
        '"branch_id" uuid',
        '"station_key" text NOT NULL',
        '"ticket_no" text NOT NULL',
        `"priority" text NOT NULL DEFAULT 'NORMAL'`,
        `"status" text NOT NULL DEFAULT 'QUEUED'`,
        '"chef_employee_id" uuid',
        '"target_minutes" integer',
        '"fired_at" timestamptz',
        '"ready_at" timestamptz',
        '"bumped_at" timestamptz',
      ]),
    );
    await uq('restaurant_kds_ticket');
    await fk('restaurant_kds_ticket', 'order_id', 'restaurant_order', 'CASCADE');
    await q.query(`CREATE INDEX "ix_restaurant_kds_queue" ON "restaurant_kds_ticket" ("tenant_id","branch_id","station_key","status")`);
    await q.query(`CREATE INDEX "ix_restaurant_kds_created" ON "restaurant_kds_ticket" ("tenant_id","branch_id","created_at")`);
    await q.query(`ALTER TABLE "restaurant_kds_ticket" ADD CONSTRAINT "ck_restaurant_kds_priority"
      CHECK ("priority" IN ('LOW','NORMAL','HIGH','VIP','RUSH'))`);
    await q.query(`ALTER TABLE "restaurant_kds_ticket" ADD CONSTRAINT "ck_restaurant_kds_status"
      CHECK ("status" IN ('QUEUED','PREPARING','READY','BUMPED','CANCELLED'))`);

    await q.query(
      createTenantTableSql('restaurant_kds_ticket_item', [
        '"ticket_id" uuid NOT NULL',
        '"order_item_id" uuid NOT NULL',
        '"name" text NOT NULL',
        '"qty" integer NOT NULL DEFAULT 1',
        '"modifiers_text" text',
        `"status" text NOT NULL DEFAULT 'QUEUED'`,
      ]),
    );
    await uq('restaurant_kds_ticket_item');
    await fk('restaurant_kds_ticket_item', 'ticket_id', 'restaurant_kds_ticket', 'CASCADE');

    // ── Recipes: a menu item's bill of materials of inventory_product ─────────────
    await q.query(
      createTenantTableSql('restaurant_recipe', [
        '"item_id" uuid NOT NULL',
        '"yield_qty" integer NOT NULL DEFAULT 1',
        '"instructions" text',
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
      ]),
    );
    await uq('restaurant_recipe');
    await fk('restaurant_recipe', 'item_id', 'restaurant_menu_item', 'CASCADE');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_recipe_item" ON "restaurant_recipe" ("tenant_id","item_id") WHERE "deleted_at" IS NULL`);

    await q.query(
      createTenantTableSql('restaurant_recipe_ingredient', [
        '"recipe_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"qty_per_yield_milli" bigint NOT NULL DEFAULT 0',
        '"unit" text',
        '"waste_bp" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('restaurant_recipe_ingredient');
    await fk('restaurant_recipe_ingredient', 'recipe_id', 'restaurant_recipe', 'CASCADE');
    await fkProduct('restaurant_recipe_ingredient', 'product_id', 'RESTRICT');
    await q.query(`CREATE INDEX "ix_restaurant_recipe_ingredient" ON "restaurant_recipe_ingredient" ("tenant_id","recipe_id")`);

    // ── Payments (split bill, tips, multiple methods) ─────────────────────────────
    await q.query(
      createTenantTableSql('restaurant_payment', [
        '"order_id" uuid NOT NULL',
        `"method" text NOT NULL DEFAULT 'CASH'`,
        '"amount_minor" bigint NOT NULL DEFAULT 0',
        '"tip_minor" bigint NOT NULL DEFAULT 0',
        '"reference" text',
        '"gift_card_id" uuid',
        '"loyalty_points" integer NOT NULL DEFAULT 0',
        `"status" text NOT NULL DEFAULT 'CAPTURED'`,
      ]),
    );
    await uq('restaurant_payment');
    await fk('restaurant_payment', 'order_id', 'restaurant_order', 'CASCADE');
    await q.query(`CREATE INDEX "ix_restaurant_payment_order" ON "restaurant_payment" ("tenant_id","order_id")`);
    await q.query(`ALTER TABLE "restaurant_payment" ADD CONSTRAINT "ck_restaurant_payment_method"
      CHECK ("method" IN ('CASH','CARD','WALLET','GIFT_CARD','LOYALTY','ONLINE','ROOM_CHARGE','AGGREGATOR','SPLIT'))`);

    // ── Own delivery: dispatch job + tracking ─────────────────────────────────────
    await q.query(
      createTenantTableSql('restaurant_delivery', [
        '"order_id" uuid NOT NULL',
        '"branch_id" uuid',
        '"delivery_no" text NOT NULL',
        `"provider" text NOT NULL DEFAULT 'OWN'`,
        '"driver_employee_id" uuid',
        '"customer_id" uuid',
        '"address" text',
        '"geo_lat" numeric(9,6)',
        '"geo_lng" numeric(9,6)',
        '"otp_code" text',
        `"status" text NOT NULL DEFAULT 'PENDING'`,
        '"assigned_at" timestamptz',
        '"picked_up_at" timestamptz',
        '"delivered_at" timestamptz',
        '"eta_minutes" integer',
        '"external_ref" text',
      ]),
    );
    await uq('restaurant_delivery');
    await fk('restaurant_delivery', 'order_id', 'restaurant_order', 'CASCADE');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_delivery_no" ON "restaurant_delivery" ("tenant_id","delivery_no")`);
    await q.query(`CREATE INDEX "ix_restaurant_delivery_status" ON "restaurant_delivery" ("tenant_id","branch_id","status")`);
    await q.query(`ALTER TABLE "restaurant_delivery" ADD CONSTRAINT "ck_restaurant_delivery_provider"
      CHECK ("provider" IN ('OWN','FOODPANDA','UBER_EATS','TALABAT','CAREEM'))`);
    await q.query(`ALTER TABLE "restaurant_delivery" ADD CONSTRAINT "ck_restaurant_delivery_status"
      CHECK ("status" IN ('PENDING','ASSIGNED','PICKED_UP','EN_ROUTE','DELIVERED','FAILED','CANCELLED'))`);

    // Driver GPS breadcrumb trail (high-volume; partition-ready on created_at).
    await q.query(
      createTenantTableSql('restaurant_delivery_track', [
        '"delivery_id" uuid NOT NULL',
        '"geo_lat" numeric(9,6) NOT NULL',
        '"geo_lng" numeric(9,6) NOT NULL',
        '"speed_kph" numeric(6,2)',
        '"recorded_at" timestamptz NOT NULL DEFAULT now()',
      ]),
    );
    await uq('restaurant_delivery_track');
    await fk('restaurant_delivery_track', 'delivery_id', 'restaurant_delivery', 'CASCADE');
    await q.query(`CREATE INDEX "ix_restaurant_delivery_track" ON "restaurant_delivery_track" ("tenant_id","delivery_id","recorded_at")`);

    // ── RLS + grants on every tenant-owned table ──────────────────────────────────
    const tables = [
      'restaurant_station', 'restaurant_order', 'restaurant_order_item',
      'restaurant_order_item_modifier', 'restaurant_kds_ticket', 'restaurant_kds_ticket_item',
      'restaurant_recipe', 'restaurant_recipe_ingredient', 'restaurant_payment',
      'restaurant_delivery', 'restaurant_delivery_track',
    ];
    for (const t of tables) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'restaurant_delivery_track', 'restaurant_delivery', 'restaurant_payment',
      'restaurant_recipe_ingredient', 'restaurant_recipe', 'restaurant_kds_ticket_item',
      'restaurant_kds_ticket', 'restaurant_order_item_modifier', 'restaurant_order_item',
      'restaurant_order', 'restaurant_station',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
