import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Budgets: a planned amount per account per fiscal period, compared against posted actuals.
 * One row per (period, account) — upsertable. Composite (tenant_id, …) FKs to fiscal_period and
 * finance_account keep it tenant-local.
 */
export class Budgets1720600000000 implements MigrationInterface {
  name = 'Budgets1720600000000';

  public async up(q: QueryRunner): Promise<void> {
    // The fiscal-period table needs a (tenant_id, id) unique to be a composite-FK target.
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_fiscal_period_tenant_id') THEN
          ALTER TABLE "finance_fiscal_period" ADD CONSTRAINT "uq_fiscal_period_tenant_id" UNIQUE ("tenant_id","id");
        END IF;
      END $$;
    `);
    await q.query(
      createTenantTableSql('finance_budget', [
        '"period_id" uuid NOT NULL',
        '"account_id" uuid NOT NULL',
        '"amount_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`ALTER TABLE "finance_budget" ADD CONSTRAINT "uq_finance_budget" UNIQUE ("tenant_id","period_id","account_id")`);
    await q.query(`CREATE INDEX "ix_finance_budget_period" ON "finance_budget" ("tenant_id","period_id")`);
    await q.query(
      `ALTER TABLE "finance_budget" ADD CONSTRAINT "fk_finance_budget_period"
       FOREIGN KEY ("tenant_id","period_id") REFERENCES "finance_fiscal_period"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "finance_budget" ADD CONSTRAINT "fk_finance_budget_account"
       FOREIGN KEY ("tenant_id","account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE CASCADE`,
    );
    for (const stmt of enableTenantRlsSql('finance_budget')) await q.query(stmt);
    await q.query(grantAppUserSql('finance_budget'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "finance_budget" CASCADE`);
  }
}
