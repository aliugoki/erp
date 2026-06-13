import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Enterprise banking controls for finance:
 *  - `finance_account.control_type` (NONE/CASH/BANK) + optional bank metadata, so voucher rules can
 *    require that receipts/payments actually touch a cash or bank account, and so cash/bank books work.
 *  - `finance_fiscal_period` (RLS) — named periods with an OPEN/CLOSED status; posting is blocked
 *    outside an open period once any periods exist.
 *  - `finance_transaction.reverses_id` / `reversed_by_id` — links a contra (reversal) voucher to the
 *    original it cancels, preserving the audit trail.
 *
 * Idempotent: IF [NOT] EXISTS columns/tables/indexes + catalog-guarded constraints.
 */
export class FinanceBankingControls1720200000000 implements MigrationInterface {
  name = 'FinanceBankingControls1720200000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Cash/Bank tagging on accounts ──────────────────────────────────────────
    await q.query(`ALTER TABLE "finance_account" ADD COLUMN IF NOT EXISTS "control_type" text NOT NULL DEFAULT 'NONE'`);
    await q.query(`ALTER TABLE "finance_account" ADD COLUMN IF NOT EXISTS "bank_name" text`);
    await q.query(`ALTER TABLE "finance_account" ADD COLUMN IF NOT EXISTS "account_number" text`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_account_control_type') THEN
          ALTER TABLE "finance_account" ADD CONSTRAINT "ck_finance_account_control_type"
            CHECK ("control_type" IN ('NONE','CASH','BANK'));
        END IF;
      END $$;
    `);

    // ── Fiscal periods ─────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "finance_fiscal_period" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" text NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "status" text NOT NULL DEFAULT 'OPEN',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "created_by" uuid,
        "updated_by" uuid
      )
    `);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_period_status') THEN
          ALTER TABLE "finance_fiscal_period" ADD CONSTRAINT "ck_finance_period_status" CHECK ("status" IN ('OPEN','CLOSED'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_period_range') THEN
          ALTER TABLE "finance_fiscal_period" ADD CONSTRAINT "ck_finance_period_range" CHECK ("end_date" >= "start_date");
        END IF;
      END $$;
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_finance_period_dates" ON "finance_fiscal_period" ("tenant_id","start_date","end_date")`);
    for (const stmt of enableTenantRlsSql('finance_fiscal_period')) await q.query(stmt);
    await q.query(grantAppUserSql('finance_fiscal_period'));

    // ── Reversal linkage on the transaction header ─────────────────────────────
    await q.query(`ALTER TABLE "finance_transaction" ADD COLUMN IF NOT EXISTS "reverses_id" uuid`);
    await q.query(`ALTER TABLE "finance_transaction" ADD COLUMN IF NOT EXISTS "reversed_by_id" uuid`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_finance_txn_reverses') THEN
          ALTER TABLE "finance_transaction" ADD CONSTRAINT "fk_finance_txn_reverses"
            FOREIGN KEY ("tenant_id","reverses_id") REFERENCES "finance_transaction"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "finance_transaction" DROP CONSTRAINT IF EXISTS "fk_finance_txn_reverses"`);
    await q.query(`ALTER TABLE "finance_transaction" DROP COLUMN IF EXISTS "reversed_by_id"`);
    await q.query(`ALTER TABLE "finance_transaction" DROP COLUMN IF EXISTS "reverses_id"`);
    for (const stmt of disableRls('finance_fiscal_period')) await q.query(stmt);
    await q.query(`DROP TABLE IF EXISTS "finance_fiscal_period"`);
    await q.query(`ALTER TABLE "finance_account" DROP CONSTRAINT IF EXISTS "ck_finance_account_control_type"`);
    await q.query(`ALTER TABLE "finance_account" DROP COLUMN IF EXISTS "account_number"`);
    await q.query(`ALTER TABLE "finance_account" DROP COLUMN IF EXISTS "bank_name"`);
    await q.query(`ALTER TABLE "finance_account" DROP COLUMN IF EXISTS "control_type"`);
  }
}

function disableRls(table: string): string[] {
  const policy = `${table}_tenant_isolation`;
  return [
    `DROP POLICY IF EXISTS "${policy}" ON "${table}"`,
    `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`,
    `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`,
  ];
}
