import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Reporting read models (Chunk 5.2). Each is a tenant-scoped (RLS) snapshot table, recomputed from the
 * operational tables by the reporting refresh job on a schedule — so report endpoints serve a cheap
 * indexed read instead of a heavy aggregation per request. Refresh replaces a tenant's rows inside its
 * RLS context (DELETE WHERE-less + INSERT…SELECT, both scoped by `app.tenant_id`).
 */
export class Reporting1719400000000 implements MigrationInterface {
  name = 'Reporting1719400000000';

  public async up(q: QueryRunner): Promise<void> {
    // Finance — monthly profit & loss buckets.
    await q.query(
      createTenantTableSql('rpt_finance_monthly', [
        '"period" date NOT NULL',
        '"revenue_minor" bigint NOT NULL DEFAULT 0',
        '"expense_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
      ]),
    );
    await q.query(`CREATE UNIQUE INDEX "uq_rpt_finance_monthly" ON "rpt_finance_monthly" ("tenant_id", "period")`);

    // Inventory — current valuation per product.
    await q.query(
      createTenantTableSql('rpt_inventory_valuation', [
        '"product_id" uuid NOT NULL',
        '"sku" text NOT NULL',
        '"name" text NOT NULL',
        `"category" text NOT NULL DEFAULT 'Uncategorized'`,
        '"on_hand" integer NOT NULL DEFAULT 0',
        '"cost_minor" bigint NOT NULL DEFAULT 0',
        '"value_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
      ]),
    );
    await q.query(`CREATE UNIQUE INDEX "uq_rpt_inventory_valuation" ON "rpt_inventory_valuation" ("tenant_id", "product_id")`);

    // HR — headcount by department + status.
    await q.query(
      createTenantTableSql('rpt_hr_headcount', [
        '"department_id" uuid',
        `"dept_name" text NOT NULL DEFAULT 'Unassigned'`,
        '"status" text NOT NULL',
        '"headcount" integer NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`CREATE INDEX "ix_rpt_hr_headcount" ON "rpt_hr_headcount" ("tenant_id", "dept_name")`);

    // CRM — pipeline totals by stage.
    await q.query(
      createTenantTableSql('rpt_crm_pipeline', [
        '"stage" text NOT NULL',
        '"deal_count" integer NOT NULL DEFAULT 0',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
      ]),
    );
    await q.query(`CREATE UNIQUE INDEX "uq_rpt_crm_pipeline" ON "rpt_crm_pipeline" ("tenant_id", "stage")`);

    for (const table of ['rpt_finance_monthly', 'rpt_inventory_valuation', 'rpt_hr_headcount', 'rpt_crm_pipeline']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['rpt_finance_monthly', 'rpt_inventory_valuation', 'rpt_hr_headcount', 'rpt_crm_pipeline']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
