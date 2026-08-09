import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Restaurant vertical — Phase 2.1 core schema (ADR-011). Foundation tables only: per-branch
 * configuration, the GL account map (consumed when a bill settles), the DYNAMIC fiscalization config
 * (which tax authority a branch reports to — PRA/FBR/SRB/KPRA/BRA — chosen at runtime), document
 * numbering, the menu system (categories, items, per-branch pricing, modifier groups + modifiers,
 * combos), the visual floor plan (areas + tables with status + merges), and reservations.
 *
 * The order / KDS / recipe / delivery schema lands in 1727710000000-RestaurantOrders. Conventions
 * follow the pharmacy vertical: tenant-scoped tables via createTenantTableSql, UNIQUE (tenant_id,id)
 * for composite FKs, RLS + app_user grants on every table, integer minor units for money, and a
 * *_doc_seq upsert table for human-readable document numbers. Menu items map to inventory_product so
 * recipe explosion (2.2) deducts the shared valued ledger — no duplicate stock.
 */
export class RestaurantCore1727700000000 implements MigrationInterface {
  name = 'RestaurantCore1727700000000';

  public async up(q: QueryRunner): Promise<void> {
    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    // Composite FK to another restaurant table (tenant-safe): (tenant_id,col) → parent(tenant_id,id).
    const fk = (t: string, col: string, parent: string, onDelete = 'RESTRICT') =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_${col}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "${parent}"("tenant_id","id") ON DELETE ${onDelete}`);
    // FK to the shared inventory product (confirmed to expose uq (tenant_id,id)).
    const fkProduct = (t: string, col = 'product_id', onDelete = 'RESTRICT') =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_${col}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "inventory_product"("tenant_id","id") ON DELETE ${onDelete}`);

    // ── Document numbering (INV, ORD, KOT, RES, DLV, …) ───────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "restaurant_doc_seq" (
        "tenant_id" uuid NOT NULL, "doc_type" text NOT NULL, "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id","doc_type"))`);

    // ── Per-branch configuration (drives service model + channels + UI) ───────────
    // branch_id / default_warehouse_id reference the shared branches/inventory modules; stored as
    // plain uuid (app-layer validated) exactly as pharmacy_gl_config stores account refs.
    await q.query(
      createTenantTableSql('restaurant_config', [
        '"branch_id" uuid',
        `"service_model" text NOT NULL DEFAULT 'DINE_IN'`,
        `"channels" text[] NOT NULL DEFAULT ARRAY['DINE_IN']::text[]`,
        '"default_warehouse_id" uuid',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"default_tax_bp" integer NOT NULL DEFAULT 0',
        '"service_charge_bp" integer NOT NULL DEFAULT 0',
        '"buffet_price_minor" bigint',
        '"auto_fire_kitchen" boolean NOT NULL DEFAULT true',
        '"tip_enabled" boolean NOT NULL DEFAULT true',
        '"rounding_enabled" boolean NOT NULL DEFAULT true',
        `"timezone" text NOT NULL DEFAULT 'Asia/Karachi'`,
      ]),
    );
    await uq('restaurant_config');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_config_branch" ON "restaurant_config" ("tenant_id","branch_id")`);
    await q.query(`ALTER TABLE "restaurant_config" ADD CONSTRAINT "ck_restaurant_service_model"
      CHECK ("service_model" IN ('DINE_IN','QSR','CAFE','CLOUD_KITCHEN','FOOD_COURT','BUFFET','DRIVE_THRU'))`);

    // ── GL account map (consumed by the settlement GL consumer) ───────────────────
    await q.query(
      createTenantTableSql('restaurant_gl_config', [
        '"revenue_account_id" uuid',
        '"tax_account_id" uuid',
        '"cogs_account_id" uuid',
        '"inventory_account_id" uuid',
        '"cash_account_id" uuid',
        '"bank_account_id" uuid',
        '"card_clearing_account_id" uuid',
        '"wallet_clearing_account_id" uuid',
        '"gift_card_liability_account_id" uuid',
        '"discount_account_id" uuid',
        '"service_charge_account_id" uuid',
        '"tips_payable_account_id" uuid',
        '"rounding_account_id" uuid',
        '"receivable_account_id" uuid',
      ]),
    );
    await uq('restaurant_gl_config');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_gl_config_tenant" ON "restaurant_gl_config" ("tenant_id")`);

    // ── DYNAMIC fiscalization config (which authority this branch reports to) ─────
    // authority is selectable at RUNTIME; switching PRA↔FBR↔… is a config write, no deploy (ADR-011 §7).
    // api_token is a secret — supplied via the secrets store / *_FILE convention, never committed.
    await q.query(
      createTenantTableSql('restaurant_fiscal_config', [
        '"branch_id" uuid',
        `"authority" text NOT NULL DEFAULT 'NONE'`,
        `"environment" text NOT NULL DEFAULT 'sandbox'`,
        '"enabled" boolean NOT NULL DEFAULT false',
        '"registration_no" text',
        '"ntn" text',
        '"strn" text',
        '"pos_id" text',
        '"api_base_url" text',
        '"api_token" text',
        '"provider_config" jsonb NOT NULL DEFAULT \'{}\'::jsonb',
      ]),
    );
    await uq('restaurant_fiscal_config');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_fiscal_config_branch" ON "restaurant_fiscal_config" ("tenant_id","branch_id")`);
    await q.query(`ALTER TABLE "restaurant_fiscal_config" ADD CONSTRAINT "ck_restaurant_fiscal_authority"
      CHECK ("authority" IN ('NONE','PRA','FBR','SRB','KPRA','BRA'))`);
    await q.query(`ALTER TABLE "restaurant_fiscal_config" ADD CONSTRAINT "ck_restaurant_fiscal_env"
      CHECK ("environment" IN ('sandbox','production'))`);

    // ── Menu: categories ──────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('restaurant_menu_category', [
        '"name" text NOT NULL',
        '"parent_id" uuid',
        '"sort_order" integer NOT NULL DEFAULT 0',
        '"active" boolean NOT NULL DEFAULT true',
        '"image_key" text',
      ]),
    );
    await uq('restaurant_menu_category');
    await fk('restaurant_menu_category', 'parent_id', 'restaurant_menu_category', 'SET NULL');
    await q.query(`CREATE INDEX "ix_restaurant_menu_category" ON "restaurant_menu_category" ("tenant_id","sort_order")`);

    // ── Menu: items (a sellable dish; optionally backed by an inventory_product) ──
    await q.query(
      createTenantTableSql('restaurant_menu_item', [
        '"category_id" uuid',
        '"product_id" uuid',
        '"sku" text',
        '"name" text NOT NULL',
        '"description" text',
        '"base_price_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"tax_bp" integer',
        '"prep_minutes" integer NOT NULL DEFAULT 0',
        '"station_key" text',
        '"calories" integer',
        '"allergens" text[] NOT NULL DEFAULT ARRAY[]::text[]',
        '"tags" text[] NOT NULL DEFAULT ARRAY[]::text[]',
        '"image_key" text',
        '"video_key" text',
        '"is_combo" boolean NOT NULL DEFAULT false',
        '"available" boolean NOT NULL DEFAULT true',
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
      ]),
    );
    await uq('restaurant_menu_item');
    await fk('restaurant_menu_item', 'category_id', 'restaurant_menu_category', 'SET NULL');
    await fkProduct('restaurant_menu_item', 'product_id', 'SET NULL');
    await q.query(`CREATE INDEX "ix_restaurant_menu_item_category" ON "restaurant_menu_item" ("tenant_id","category_id")`);
    await q.query(`CREATE INDEX "ix_restaurant_menu_item_name" ON "restaurant_menu_item" ("tenant_id", lower("name"))`);
    await q.query(`ALTER TABLE "restaurant_menu_item" ADD CONSTRAINT "ck_restaurant_menu_item_status" CHECK ("status" IN ('ACTIVE','INACTIVE'))`);

    // ── Menu: per-branch price / availability override (franchise pricing) ────────
    await q.query(
      createTenantTableSql('restaurant_menu_item_branch', [
        '"item_id" uuid NOT NULL',
        '"branch_id" uuid NOT NULL',
        '"price_minor" bigint',
        '"available" boolean NOT NULL DEFAULT true',
      ]),
    );
    await uq('restaurant_menu_item_branch');
    await fk('restaurant_menu_item_branch', 'item_id', 'restaurant_menu_item', 'CASCADE');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_menu_item_branch" ON "restaurant_menu_item_branch" ("tenant_id","item_id","branch_id")`);

    // ── Menu: modifier groups (e.g. "Spice level", "Add-ons") + modifiers ─────────
    await q.query(
      createTenantTableSql('restaurant_modifier_group', [
        '"name" text NOT NULL',
        '"min_select" integer NOT NULL DEFAULT 0',
        '"max_select" integer',
        '"required" boolean NOT NULL DEFAULT false',
        '"sort_order" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('restaurant_modifier_group');

    await q.query(
      createTenantTableSql('restaurant_modifier', [
        '"group_id" uuid NOT NULL',
        '"name" text NOT NULL',
        '"price_delta_minor" bigint NOT NULL DEFAULT 0',
        '"product_id" uuid',
        '"sort_order" integer NOT NULL DEFAULT 0',
        '"available" boolean NOT NULL DEFAULT true',
      ]),
    );
    await uq('restaurant_modifier');
    await fk('restaurant_modifier', 'group_id', 'restaurant_modifier_group', 'CASCADE');
    await fkProduct('restaurant_modifier', 'product_id', 'SET NULL');

    // Item ↔ modifier-group attachment (many-to-many).
    await q.query(
      createTenantTableSql('restaurant_item_modifier_group', [
        '"item_id" uuid NOT NULL',
        '"group_id" uuid NOT NULL',
        '"sort_order" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('restaurant_item_modifier_group');
    await fk('restaurant_item_modifier_group', 'item_id', 'restaurant_menu_item', 'CASCADE');
    await fk('restaurant_item_modifier_group', 'group_id', 'restaurant_modifier_group', 'CASCADE');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_item_modifier_group" ON "restaurant_item_modifier_group" ("tenant_id","item_id","group_id")`);

    // ── Menu: combo components (a combo item is composed of other items) ──────────
    await q.query(
      createTenantTableSql('restaurant_combo_component', [
        '"combo_item_id" uuid NOT NULL',
        '"component_item_id" uuid NOT NULL',
        '"qty" integer NOT NULL DEFAULT 1',
        '"price_delta_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('restaurant_combo_component');
    await fk('restaurant_combo_component', 'combo_item_id', 'restaurant_menu_item', 'CASCADE');
    await fk('restaurant_combo_component', 'component_item_id', 'restaurant_menu_item', 'RESTRICT');
    await q.query(`CREATE INDEX "ix_restaurant_combo_component" ON "restaurant_combo_component" ("tenant_id","combo_item_id")`);

    // ── Floor plan: areas (indoor / outdoor / VIP / terrace / garden / room) ──────
    await q.query(
      createTenantTableSql('restaurant_floor_area', [
        '"branch_id" uuid',
        '"name" text NOT NULL',
        `"kind" text NOT NULL DEFAULT 'INDOOR'`,
        '"sort_order" integer NOT NULL DEFAULT 0',
        '"layout" jsonb NOT NULL DEFAULT \'{}\'::jsonb',
      ]),
    );
    await uq('restaurant_floor_area');
    await q.query(`CREATE INDEX "ix_restaurant_floor_area_branch" ON "restaurant_floor_area" ("tenant_id","branch_id")`);
    await q.query(`ALTER TABLE "restaurant_floor_area" ADD CONSTRAINT "ck_restaurant_area_kind"
      CHECK ("kind" IN ('INDOOR','OUTDOOR','VIP','TERRACE','GARDEN','PRIVATE_ROOM'))`);

    // ── Floor plan: tables (with x/y for the drag-and-drop designer + live status) ─
    await q.query(
      createTenantTableSql('restaurant_table', [
        '"area_id" uuid',
        '"branch_id" uuid',
        '"code" text NOT NULL',
        '"capacity" integer NOT NULL DEFAULT 2',
        `"shape" text NOT NULL DEFAULT 'SQUARE'`,
        '"pos_x" integer NOT NULL DEFAULT 0',
        '"pos_y" integer NOT NULL DEFAULT 0',
        '"width" integer NOT NULL DEFAULT 80',
        '"height" integer NOT NULL DEFAULT 80',
        '"rotation" integer NOT NULL DEFAULT 0',
        `"status" text NOT NULL DEFAULT 'AVAILABLE'`,
        '"merged_into_id" uuid',
        '"active" boolean NOT NULL DEFAULT true',
      ]),
    );
    await uq('restaurant_table');
    await fk('restaurant_table', 'area_id', 'restaurant_floor_area', 'SET NULL');
    await fk('restaurant_table', 'merged_into_id', 'restaurant_table', 'SET NULL');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_table_code" ON "restaurant_table" ("tenant_id","branch_id","code") WHERE "deleted_at" IS NULL`);
    await q.query(`CREATE INDEX "ix_restaurant_table_status" ON "restaurant_table" ("tenant_id","branch_id","status")`);
    await q.query(`ALTER TABLE "restaurant_table" ADD CONSTRAINT "ck_restaurant_table_status"
      CHECK ("status" IN ('AVAILABLE','OCCUPIED','RESERVED','CLEANING','WAITING'))`);

    // ── Reservations (online booking + waitlist + QR check-in) ────────────────────
    await q.query(
      createTenantTableSql('restaurant_reservation', [
        '"branch_id" uuid',
        '"reservation_no" text NOT NULL',
        '"customer_id" uuid',
        '"table_id" uuid',
        '"guest_name" text',
        '"guest_phone" text',
        '"party_size" integer NOT NULL DEFAULT 2',
        '"reserved_for" timestamptz NOT NULL',
        '"duration_minutes" integer NOT NULL DEFAULT 90',
        `"status" text NOT NULL DEFAULT 'BOOKED'`,
        '"checkin_code" text',
        '"notes" text',
      ]),
    );
    await uq('restaurant_reservation');
    await fk('restaurant_reservation', 'table_id', 'restaurant_table', 'SET NULL');
    await q.query(`CREATE INDEX "ix_restaurant_reservation_when" ON "restaurant_reservation" ("tenant_id","branch_id","reserved_for")`);
    await q.query(`ALTER TABLE "restaurant_reservation" ADD CONSTRAINT "ck_restaurant_reservation_status"
      CHECK ("status" IN ('BOOKED','CONFIRMED','WAITLIST','SEATED','COMPLETED','NO_SHOW','CANCELLED'))`);

    // ── RLS + grants on every tenant-owned table ──────────────────────────────────
    const tables = [
      'restaurant_config', 'restaurant_gl_config', 'restaurant_fiscal_config',
      'restaurant_menu_category', 'restaurant_menu_item', 'restaurant_menu_item_branch',
      'restaurant_modifier_group', 'restaurant_modifier', 'restaurant_item_modifier_group',
      'restaurant_combo_component', 'restaurant_floor_area', 'restaurant_table', 'restaurant_reservation',
    ];
    for (const t of [...tables, 'restaurant_doc_seq']) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'restaurant_reservation', 'restaurant_table', 'restaurant_floor_area',
      'restaurant_combo_component', 'restaurant_item_modifier_group', 'restaurant_modifier',
      'restaurant_modifier_group', 'restaurant_menu_item_branch', 'restaurant_menu_item',
      'restaurant_menu_category', 'restaurant_fiscal_config', 'restaurant_gl_config',
      'restaurant_config', 'restaurant_doc_seq',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
