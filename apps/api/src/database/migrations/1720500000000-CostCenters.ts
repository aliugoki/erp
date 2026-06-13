import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Cost centers (analytical dimension). A journal line may carry a cost_center_id so income/expense
 * can be sliced by branch / department / project for a cost-center P&L. Nullable — untagged lines
 * roll up to "Unassigned". Composite (tenant_id, cost_center_id) FK keeps the dimension tenant-local.
 */
export class CostCenters1720500000000 implements MigrationInterface {
  name = 'CostCenters1720500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('cost_center', [
        '"code" text NOT NULL',
        '"name" text NOT NULL',
        '"active" boolean NOT NULL DEFAULT true',
      ]),
    );
    await q.query(`ALTER TABLE "cost_center" ADD CONSTRAINT "uq_cost_center_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_cost_center_code" ON "cost_center" ("tenant_id", lower("code"))`);
    for (const stmt of enableTenantRlsSql('cost_center')) await q.query(stmt);
    await q.query(grantAppUserSql('cost_center'));

    await q.query(`ALTER TABLE "finance_journal_entry" ADD COLUMN IF NOT EXISTS "cost_center_id" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_finance_journal_cost_center" ON "finance_journal_entry" ("tenant_id","cost_center_id")`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_finance_journal_cost_center') THEN
          ALTER TABLE "finance_journal_entry" ADD CONSTRAINT "fk_finance_journal_cost_center"
            FOREIGN KEY ("tenant_id","cost_center_id") REFERENCES "cost_center"("tenant_id","id") ON DELETE RESTRICT;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "finance_journal_entry" DROP CONSTRAINT IF EXISTS "fk_finance_journal_cost_center"`);
    await q.query(`DROP INDEX IF EXISTS "ix_finance_journal_cost_center"`);
    await q.query(`ALTER TABLE "finance_journal_entry" DROP COLUMN IF EXISTS "cost_center_id"`);
    await q.query(`DROP TABLE IF EXISTS "cost_center" CASCADE`);
  }
}
