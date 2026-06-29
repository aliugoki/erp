import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, disableTenantRlsSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Scheduled report emails. Each row schedules a preset OR a saved custom report to be rendered
 * (pdf/xlsx/csv) and emailed to `recipients` on a daily/weekly/monthly cadence. A tick (gated by
 * REPORT_SCHEDULES_ENABLED) renders + enqueues due rows and advances `next_run_at`. Tenant-scoped + RLS.
 */
export class ReportSchedule1726800000000 implements MigrationInterface {
  name = 'ReportSchedule1726800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('report_schedule', [
        '"name" text NOT NULL',
        '"preset_key" text',
        '"report_id" uuid',
        `"format" text NOT NULL DEFAULT 'pdf'`,
        `"recipients" jsonb NOT NULL DEFAULT '[]'::jsonb`,
        `"frequency" text NOT NULL DEFAULT 'daily'`,
        '"hour" int NOT NULL DEFAULT 8',
        '"minute" int NOT NULL DEFAULT 0',
        '"day_of_week" int',
        '"day_of_month" int',
        '"enabled" boolean NOT NULL DEFAULT true',
        '"last_run_at" timestamptz',
        '"next_run_at" timestamptz NOT NULL DEFAULT now()',
      ]),
    );
    // A schedule targets exactly one of a preset or a saved report.
    await q.query(
      `ALTER TABLE "report_schedule" ADD CONSTRAINT "ck_report_schedule_target"
       CHECK ((preset_key IS NOT NULL) <> (report_id IS NOT NULL))`,
    );
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_report_schedule_due" ON "report_schedule" ("enabled","next_run_at")`);
    for (const stmt of enableTenantRlsSql('report_schedule')) await q.query(stmt);
    await q.query(grantAppUserSql('report_schedule'));
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const stmt of disableTenantRlsSql('report_schedule')) await q.query(stmt);
    await q.query(`DROP TABLE IF EXISTS "report_schedule"`);
  }
}
