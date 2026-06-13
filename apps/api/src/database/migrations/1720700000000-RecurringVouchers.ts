import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Recurring vouchers: a saved voucher template + schedule that generates a real voucher each period
 * (rent, salaries, subscriptions). `entries` holds the template legs as JSON; generation runs them
 * through the normal posting path. `next_run_date` advances by `frequency` after each run.
 */
export class RecurringVouchers1720700000000 implements MigrationInterface {
  name = 'RecurringVouchers1720700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('recurring_voucher', [
        '"description" text NOT NULL',
        `"voucher_type" text NOT NULL DEFAULT 'JV'`,
        '"frequency" text NOT NULL',
        '"next_run_date" date NOT NULL',
        '"end_date" date',
        '"active" boolean NOT NULL DEFAULT true',
        `"entries" jsonb NOT NULL DEFAULT '[]'`,
      ]),
    );
    await q.query(
      `ALTER TABLE "recurring_voucher" ADD CONSTRAINT "ck_recurring_frequency"
       CHECK ("frequency" IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY'))`,
    );
    await q.query(
      `ALTER TABLE "recurring_voucher" ADD CONSTRAINT "ck_recurring_voucher_type"
       CHECK ("voucher_type" IN ('BRV','BPV','CPV','CRV','JV'))`,
    );
    await q.query(`CREATE INDEX "ix_recurring_due" ON "recurring_voucher" ("tenant_id","active","next_run_date")`);
    for (const stmt of enableTenantRlsSql('recurring_voucher')) await q.query(stmt);
    await q.query(grantAppUserSql('recurring_voucher'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "recurring_voucher" CASCADE`);
  }
}
