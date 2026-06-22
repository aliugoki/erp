import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Pharmacy Management System. A configurable pharmacy vertical (RETAIL / HOSPITAL / WHOLESALE) layered
 * on the existing inventory valued ledger + finance GL. A `pharmacy_drug` enriches an `inventory_product`
 * with pharma metadata (generic/brand, strength, form, schedule, Rx-required). The key addition over
 * plain inventory is **batch + expiry**: every receipt creates a `pharmacy_stock_lot` (lot_no, expiry,
 * qty, cost) and dispensing allocates **FEFO** (first-expiry-first-out) across lots, while value still
 * flows through `inventory_ledger` (weighted-average) for one source of stock truth. Dispensing a
 * controlled/scheduled drug appends to the immutable `pharmacy_controlled_register` (narcotics audit).
 * GL posting reads `pharmacy_gl_config`. Tenant-scoped (RLS); money is integer minor units; document
 * numbers come from `pharmacy_doc_seq`.
 */
export class Pharmacy1726000000000 implements MigrationInterface {
  name = 'Pharmacy1726000000000';

  public async up(q: QueryRunner): Promise<void> {
    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fkProduct = (t: string, col = 'product_id', onDelete = 'RESTRICT') =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_${col}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "inventory_product"("tenant_id","id") ON DELETE ${onDelete}`);

    // ── Document numbering ────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "pharmacy_doc_seq" (
        "tenant_id" uuid NOT NULL, "doc_type" text NOT NULL, "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id","doc_type"))`);

    // ── Per-tenant configuration (mode + policies) ────────────────────────────────
    await q.query(
      createTenantTableSql('pharmacy_config', [
        `"mode" text NOT NULL DEFAULT 'RETAIL'`,
        `"controlled_register_enabled" boolean NOT NULL DEFAULT true`,
        '"near_expiry_days" integer NOT NULL DEFAULT 90',
        '"allow_dispense_without_stock" boolean NOT NULL DEFAULT false',
        '"default_warehouse_id" uuid',
        '"default_tax_bp" integer NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
      ]),
    );
    await uq('pharmacy_config');
    await q.query(`CREATE UNIQUE INDEX "uq_pharmacy_config_tenant" ON "pharmacy_config" ("tenant_id")`);
    await q.query(`ALTER TABLE "pharmacy_config" ADD CONSTRAINT "ck_pharmacy_mode" CHECK ("mode" IN ('RETAIL','HOSPITAL','WHOLESALE'))`);

    // ── GL account map (consumed when posting dispenses) ──────────────────────────
    await q.query(
      createTenantTableSql('pharmacy_gl_config', [
        '"inventory_account_id" uuid',
        '"revenue_account_id" uuid',
        '"cogs_account_id" uuid',
        '"tax_account_id" uuid',
        '"discount_account_id" uuid',
        '"receivable_account_id" uuid',
        '"clearing_account_id" uuid',
        '"writeoff_account_id" uuid',
      ]),
    );
    await uq('pharmacy_gl_config');
    await q.query(`CREATE UNIQUE INDEX "uq_pharmacy_gl_config_tenant" ON "pharmacy_gl_config" ("tenant_id")`);

    // ── Drug master (enriches an inventory_product) ───────────────────────────────
    await q.query(
      createTenantTableSql('pharmacy_drug', [
        '"product_id" uuid NOT NULL',
        '"generic_name" text',
        '"brand" text',
        '"manufacturer" text',
        '"strength" text',
        `"form" text NOT NULL DEFAULT 'TABLET'`,
        '"pack_size" integer NOT NULL DEFAULT 1',
        `"schedule" text NOT NULL DEFAULT 'OTC'`,
        '"rx_required" boolean NOT NULL DEFAULT false',
        '"controlled" boolean NOT NULL DEFAULT false',
        '"therapeutic_category" text',
        '"barcode" text',
        '"reorder_level" integer NOT NULL DEFAULT 0',
        '"max_level" integer',
        `"storage" text NOT NULL DEFAULT 'ROOM'`,
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
      ]),
    );
    await uq('pharmacy_drug');
    await fkProduct('pharmacy_drug', 'product_id', 'CASCADE');
    await q.query(`CREATE UNIQUE INDEX "uq_pharmacy_drug_product" ON "pharmacy_drug" ("tenant_id","product_id") WHERE "deleted_at" IS NULL`);
    await q.query(`CREATE INDEX "ix_pharmacy_drug_generic" ON "pharmacy_drug" ("tenant_id", lower("generic_name"))`);
    await q.query(`CREATE INDEX "ix_pharmacy_drug_schedule" ON "pharmacy_drug" ("tenant_id","schedule")`);
    await q.query(`ALTER TABLE "pharmacy_drug" ADD CONSTRAINT "ck_pharmacy_drug_schedule" CHECK ("schedule" IN ('OTC','RX','SCHEDULE_G','NARCOTIC','PSYCHOTROPIC'))`);
    await q.query(`ALTER TABLE "pharmacy_drug" ADD CONSTRAINT "ck_pharmacy_drug_status" CHECK ("status" IN ('ACTIVE','INACTIVE'))`);

    // ── Stock lots (batch + expiry; the FEFO unit) ────────────────────────────────
    await q.query(
      createTenantTableSql('pharmacy_stock_lot', [
        '"product_id" uuid NOT NULL',
        '"lot_no" text NOT NULL',
        '"expiry_date" date',
        '"qty_on_hand" integer NOT NULL DEFAULT 0',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
        '"vendor_id" uuid',
        '"received_on" date NOT NULL DEFAULT current_date',
        '"doc_no" text',
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
      ]),
    );
    await uq('pharmacy_stock_lot');
    await fkProduct('pharmacy_stock_lot', 'product_id', 'RESTRICT');
    await q.query(`ALTER TABLE "pharmacy_stock_lot" ADD CONSTRAINT "ck_pharmacy_lot_qty" CHECK ("qty_on_hand" >= 0)`);
    await q.query(`CREATE INDEX "ix_pharmacy_lot_fefo" ON "pharmacy_stock_lot" ("tenant_id","product_id","expiry_date")`);
    await q.query(`CREATE INDEX "ix_pharmacy_lot_expiry" ON "pharmacy_stock_lot" ("tenant_id","expiry_date")`);

    // ── Lot-level movement log (value still flows via inventory_ledger) ───────────
    await q.query(
      createTenantTableSql('pharmacy_lot_movement', [
        '"lot_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"doc_type" text NOT NULL',
        '"doc_no" text',
        '"qty_in" integer NOT NULL DEFAULT 0',
        '"qty_out" integer NOT NULL DEFAULT 0',
        '"balance_qty" integer NOT NULL DEFAULT 0',
        '"occurred_on" date NOT NULL DEFAULT current_date',
        '"narration" text',
      ]),
    );
    await uq('pharmacy_lot_movement');
    await q.query(`CREATE INDEX "ix_pharmacy_lot_movement_lot" ON "pharmacy_lot_movement" ("tenant_id","lot_id")`);
    await q.query(`ALTER TABLE "pharmacy_lot_movement" ADD CONSTRAINT "fk_pharmacy_lot_movement_lot"
      FOREIGN KEY ("tenant_id","lot_id") REFERENCES "pharmacy_stock_lot"("tenant_id","id") ON DELETE CASCADE`);

    // ── Receipts (batch goods-in; creates lots) ───────────────────────────────────
    await q.query(
      createTenantTableSql('pharmacy_receipt', [
        '"receipt_no" text NOT NULL',
        '"vendor_id" uuid',
        '"warehouse_id" uuid',
        '"grn_id" uuid',
        '"received_on" date NOT NULL DEFAULT current_date',
        '"currency" text NOT NULL DEFAULT \'PKR\'',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"notes" text',
        `"status" text NOT NULL DEFAULT 'POSTED'`,
      ]),
    );
    await uq('pharmacy_receipt');
    await q.query(`CREATE INDEX "ix_pharmacy_receipt_date" ON "pharmacy_receipt" ("tenant_id","received_on")`);

    await q.query(
      createTenantTableSql('pharmacy_receipt_item', [
        '"receipt_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"lot_id" uuid',
        '"lot_no" text NOT NULL',
        '"expiry_date" date',
        '"qty" integer NOT NULL',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('pharmacy_receipt_item');
    await q.query(`ALTER TABLE "pharmacy_receipt_item" ADD CONSTRAINT "fk_pharmacy_receipt_item_receipt"
      FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "pharmacy_receipt"("tenant_id","id") ON DELETE CASCADE`);

    // ── Dispenses (retail sale / Rx / hospital issue / wholesale) ─────────────────
    await q.query(
      createTenantTableSql('pharmacy_dispense', [
        '"dispense_no" text NOT NULL',
        `"type" text NOT NULL DEFAULT 'RETAIL_SALE'`,
        '"customer_id" uuid',
        '"patient_ref" text',
        '"prescriber" text',
        '"prescription_ref" text',
        '"ward" text',
        '"currency" text NOT NULL DEFAULT \'PKR\'',
        '"subtotal_minor" bigint NOT NULL DEFAULT 0',
        '"discount_minor" bigint NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"cogs_minor" bigint NOT NULL DEFAULT 0',
        `"payment_method" text NOT NULL DEFAULT 'CASH'`,
        '"insurer" text',
        '"insurance_cover_minor" bigint NOT NULL DEFAULT 0',
        '"occurred_on" date NOT NULL DEFAULT current_date',
        `"status" text NOT NULL DEFAULT 'COMPLETED'`,
        '"notes" text',
      ]),
    );
    await uq('pharmacy_dispense');
    await q.query(`CREATE INDEX "ix_pharmacy_dispense_date" ON "pharmacy_dispense" ("tenant_id","occurred_on")`);
    await q.query(`CREATE INDEX "ix_pharmacy_dispense_type" ON "pharmacy_dispense" ("tenant_id","type")`);
    await q.query(`ALTER TABLE "pharmacy_dispense" ADD CONSTRAINT "ck_pharmacy_dispense_type" CHECK ("type" IN ('RETAIL_SALE','RX','HOSPITAL_ISSUE','WHOLESALE'))`);
    await q.query(`ALTER TABLE "pharmacy_dispense" ADD CONSTRAINT "ck_pharmacy_dispense_status" CHECK ("status" IN ('COMPLETED','RETURNED','VOID'))`);

    await q.query(
      createTenantTableSql('pharmacy_dispense_item', [
        '"dispense_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"lot_id" uuid',
        '"lot_no" text',
        '"expiry_date" date',
        '"qty" integer NOT NULL',
        '"unit_price_minor" bigint NOT NULL DEFAULT 0',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
        '"discount_minor" bigint NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"line_total_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('pharmacy_dispense_item');
    await q.query(`ALTER TABLE "pharmacy_dispense_item" ADD CONSTRAINT "fk_pharmacy_dispense_item_dispense"
      FOREIGN KEY ("tenant_id","dispense_id") REFERENCES "pharmacy_dispense"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE INDEX "ix_pharmacy_dispense_item_product" ON "pharmacy_dispense_item" ("tenant_id","product_id")`);

    // ── Controlled-substance register (narcotics audit; append-only) ──────────────
    await q.query(
      createTenantTableSql('pharmacy_controlled_register', [
        '"product_id" uuid NOT NULL',
        '"dispense_id" uuid',
        `"direction" text NOT NULL DEFAULT 'OUT'`,
        '"lot_no" text',
        '"qty" integer NOT NULL',
        '"balance_after" integer NOT NULL DEFAULT 0',
        '"schedule" text',
        '"prescriber" text',
        '"patient_ref" text',
        '"prescription_ref" text',
        '"occurred_on" date NOT NULL DEFAULT current_date',
        '"notes" text',
      ]),
    );
    await uq('pharmacy_controlled_register');
    await q.query(`CREATE INDEX "ix_pharmacy_controlled_product" ON "pharmacy_controlled_register" ("tenant_id","product_id","occurred_on")`);

    // ── RLS + grants on every tenant-owned table ──────────────────────────────────
    const tables = [
      'pharmacy_config', 'pharmacy_gl_config', 'pharmacy_drug', 'pharmacy_stock_lot',
      'pharmacy_lot_movement', 'pharmacy_receipt', 'pharmacy_receipt_item', 'pharmacy_dispense',
      'pharmacy_dispense_item', 'pharmacy_controlled_register',
    ];
    for (const t of [...tables, 'pharmacy_doc_seq']) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'pharmacy_controlled_register', 'pharmacy_dispense_item', 'pharmacy_dispense',
      'pharmacy_receipt_item', 'pharmacy_receipt', 'pharmacy_lot_movement', 'pharmacy_stock_lot',
      'pharmacy_drug', 'pharmacy_gl_config', 'pharmacy_config', 'pharmacy_doc_seq',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
