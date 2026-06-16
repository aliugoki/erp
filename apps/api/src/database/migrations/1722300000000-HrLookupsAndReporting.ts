import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Managed HR designations + the saved report-definition store for the report builder.
 *
 * - `hr_designation`: a tenant-managed list of job designations (like departments) that the employee
 *   form offers as a dropdown. The employee's `designation` stays free-text (denormalised), populated
 *   from this list.
 * - `rpt_report_definition`: a saved custom report — a whitelisted dataset key plus selected columns,
 *   equality filters and an optional group-by (all stored as JSON; the executor only ever emits
 *   columns from a server-side allowlist, never raw user SQL).
 *
 * RLS + composite keys as usual. AI insights are computed on the fly from existing tables — no schema.
 */
export class HrLookupsAndReporting1722300000000 implements MigrationInterface {
  name = 'HrLookupsAndReporting1722300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(createTenantTableSql('hr_designation', ['"name" text NOT NULL', '"description" text']));
    await q.query(`ALTER TABLE "hr_designation" ADD CONSTRAINT "uq_hr_designation_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_hr_designation_name" ON "hr_designation" ("tenant_id", lower("name"))`);

    await q.query(
      createTenantTableSql('rpt_report_definition', [
        '"name" text NOT NULL',
        '"source" text NOT NULL',
        `"columns" jsonb NOT NULL DEFAULT '[]'::jsonb`,
        `"filters" jsonb NOT NULL DEFAULT '[]'::jsonb`,
        '"group_by" text',
      ]),
    );
    await q.query(`ALTER TABLE "rpt_report_definition" ADD CONSTRAINT "uq_rpt_report_definition_tenant_id" UNIQUE ("tenant_id","id")`);

    for (const table of ['hr_designation', 'rpt_report_definition']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "rpt_report_definition" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "hr_designation" CASCADE`);
  }
}
