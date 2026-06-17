import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Fixed Asset Management. An `asset` (grouped by `asset_category`, optionally held by an hr_employee
 * custodian) carries an acquisition cost and a depreciation policy (straight-line or double-declining).
 * A periodic `asset_depreciation_run` writes one `asset_depreciation` row per active asset for the
 * period — unique on (asset, period) so a period is never depreciated twice — advancing each asset's
 * accumulated depreciation toward (cost − salvage). Disposal records the gain/loss vs book value;
 * `asset_maintenance` logs upkeep. Tenant-scoped (RLS); money is integer minor units; numbers from
 * `asset_doc_seq`. Depreciation totals are emitted to finance via the outbox (`asset.depreciation_posted`).
 */
export class Assets1723400000000 implements MigrationInterface {
  name = 'Assets1723400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "asset_doc_seq" (
        "tenant_id" uuid NOT NULL, "doc_type" text NOT NULL, "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id","doc_type"))`);
    for (const stmt of enableTenantRlsSql('asset_doc_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('asset_doc_seq'));

    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);

    // ── Categories ──────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('asset_category', [
        '"name" text NOT NULL',
        '"code" text',
        `"method" text NOT NULL DEFAULT 'STRAIGHT_LINE'`,
        '"useful_life_months" integer NOT NULL DEFAULT 60',
        '"salvage_pct" integer NOT NULL DEFAULT 0',
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
      ]),
    );
    await uq('asset_category');
    await q.query(`ALTER TABLE "asset_category" ADD CONSTRAINT "ck_asset_cat_method" CHECK ("method" IN ('STRAIGHT_LINE','DECLINING_BALANCE','NONE'))`);
    await q.query(`ALTER TABLE "asset_category" ADD CONSTRAINT "ck_asset_cat_salvage" CHECK ("salvage_pct" BETWEEN 0 AND 100)`);

    // ── Assets ──────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('asset', [
        '"asset_no" text NOT NULL',
        '"name" text NOT NULL',
        '"category_id" uuid',
        '"description" text',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"acquisition_date" date',
        '"acquisition_cost_minor" bigint NOT NULL DEFAULT 0',
        '"salvage_value_minor" bigint NOT NULL DEFAULT 0',
        '"useful_life_months" integer NOT NULL DEFAULT 60',
        `"method" text NOT NULL DEFAULT 'STRAIGHT_LINE'`,
        '"depreciation_start" date',
        '"accumulated_depreciation_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"location" text',
        '"custodian_employee_id" uuid',
        '"serial_no" text',
        '"supplier" text',
        '"disposal_date" date',
        '"disposal_proceeds_minor" bigint',
        '"disposal_gain_minor" bigint',
        '"notes" text',
      ]),
    );
    await uq('asset');
    await q.query(`ALTER TABLE "asset" ADD CONSTRAINT "ck_asset_status" CHECK ("status" IN ('DRAFT','ACTIVE','DISPOSED','WRITTEN_OFF'))`);
    await q.query(`ALTER TABLE "asset" ADD CONSTRAINT "ck_asset_method" CHECK ("method" IN ('STRAIGHT_LINE','DECLINING_BALANCE','NONE'))`);
    await q.query(`CREATE INDEX "ix_asset_status" ON "asset" ("tenant_id","status")`);
    await q.query(`CREATE INDEX "ix_asset_category" ON "asset" ("tenant_id","category_id")`);
    await q.query(`ALTER TABLE "asset" ADD CONSTRAINT "fk_asset_category"
      FOREIGN KEY ("tenant_id","category_id") REFERENCES "asset_category"("tenant_id","id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "asset" ADD CONSTRAINT "fk_asset_custodian"
      FOREIGN KEY ("tenant_id","custodian_employee_id") REFERENCES "hr_employee"("tenant_id","id") ON DELETE SET NULL`);

    // ── Depreciation runs + entries ─────────────────────────────────────────────
    await q.query(
      createTenantTableSql('asset_depreciation_run', [
        '"run_no" text NOT NULL',
        '"period" date NOT NULL',
        `"status" text NOT NULL DEFAULT 'POSTED'`,
        '"asset_count" integer NOT NULL DEFAULT 0',
        '"total_amount_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"notes" text',
      ]),
    );
    await uq('asset_depreciation_run');
    await q.query(`CREATE INDEX "ix_asset_run_period" ON "asset_depreciation_run" ("tenant_id","period")`);

    await q.query(
      createTenantTableSql('asset_depreciation', [
        '"asset_id" uuid NOT NULL',
        '"run_id" uuid',
        '"period" date NOT NULL',
        '"amount_minor" bigint NOT NULL DEFAULT 0',
        '"accumulated_after_minor" bigint NOT NULL DEFAULT 0',
        '"book_value_after_minor" bigint NOT NULL DEFAULT 0',
        '"method" text NOT NULL',
      ]),
    );
    await uq('asset_depreciation');
    await q.query(`CREATE UNIQUE INDEX "uq_asset_depr_period" ON "asset_depreciation" ("tenant_id","asset_id","period")`);
    await q.query(`CREATE INDEX "ix_asset_depr_asset" ON "asset_depreciation" ("tenant_id","asset_id")`);
    await q.query(`ALTER TABLE "asset_depreciation" ADD CONSTRAINT "fk_asset_depr_asset"
      FOREIGN KEY ("tenant_id","asset_id") REFERENCES "asset"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "asset_depreciation" ADD CONSTRAINT "fk_asset_depr_run"
      FOREIGN KEY ("tenant_id","run_id") REFERENCES "asset_depreciation_run"("tenant_id","id") ON DELETE SET NULL`);

    // ── Maintenance ─────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('asset_maintenance', [
        '"asset_id" uuid NOT NULL',
        '"maint_date" date NOT NULL DEFAULT current_date',
        `"type" text NOT NULL DEFAULT 'SERVICE'`,
        '"description" text',
        '"cost_minor" bigint NOT NULL DEFAULT 0',
        '"vendor" text',
        '"next_due_date" date',
      ]),
    );
    await uq('asset_maintenance');
    await q.query(`ALTER TABLE "asset_maintenance" ADD CONSTRAINT "ck_asset_maint_type" CHECK ("type" IN ('REPAIR','SERVICE','INSPECTION','UPGRADE','OTHER'))`);
    await q.query(`CREATE INDEX "ix_asset_maint_asset" ON "asset_maintenance" ("tenant_id","asset_id")`);
    await q.query(`CREATE INDEX "ix_asset_maint_due" ON "asset_maintenance" ("tenant_id","next_due_date")`);
    await q.query(`ALTER TABLE "asset_maintenance" ADD CONSTRAINT "fk_asset_maint_asset"
      FOREIGN KEY ("tenant_id","asset_id") REFERENCES "asset"("tenant_id","id") ON DELETE CASCADE`);

    for (const t of ['asset_category', 'asset', 'asset_depreciation_run', 'asset_depreciation', 'asset_maintenance']) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['asset_maintenance', 'asset_depreciation', 'asset_depreciation_run', 'asset', 'asset_category', 'asset_doc_seq']) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
