import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Maker/checker posting workflow + bank reconciliation flags.
 *  - `finance_transaction.status` (DRAFT/POSTED) + `posted_at`: a voucher can be saved as a DRAFT and
 *    later POSTED (approved). Only POSTED vouchers hit the ledger/statements. Default POSTED so every
 *    existing row and the unchanged create path stay live (backward compatible).
 *  - `finance_journal_entry.reconciled` + `reconciled_at`: mark a bank/cash posting as cleared on a
 *    statement for bank reconciliation.
 *
 * Idempotent: IF [NOT] EXISTS columns/indexes + a catalog-guarded CHECK; backfill only fills NULLs.
 */
export class FinanceWorkflowAndRecon1720300000000 implements MigrationInterface {
  name = 'FinanceWorkflowAndRecon1720300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "finance_transaction" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'POSTED'`);
    await q.query(`ALTER TABLE "finance_transaction" ADD COLUMN IF NOT EXISTS "posted_at" timestamptz`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_txn_status') THEN
          ALTER TABLE "finance_transaction" ADD CONSTRAINT "ck_finance_txn_status" CHECK ("status" IN ('DRAFT','POSTED'));
        END IF;
      END $$;
    `);
    // Existing rows are already in the books → stamp them posted.
    await q.query(`UPDATE "finance_transaction" SET "posted_at" = "created_at" WHERE "status" = 'POSTED' AND "posted_at" IS NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_finance_txn_status" ON "finance_transaction" ("tenant_id","status")`);

    await q.query(`ALTER TABLE "finance_journal_entry" ADD COLUMN IF NOT EXISTS "reconciled" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "finance_journal_entry" ADD COLUMN IF NOT EXISTS "reconciled_at" date`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_finance_journal_account_recon" ON "finance_journal_entry" ("tenant_id","account_id","reconciled")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_finance_journal_account_recon"`);
    await q.query(`ALTER TABLE "finance_journal_entry" DROP COLUMN IF EXISTS "reconciled_at"`);
    await q.query(`ALTER TABLE "finance_journal_entry" DROP COLUMN IF EXISTS "reconciled"`);
    await q.query(`DROP INDEX IF EXISTS "ix_finance_txn_status"`);
    await q.query(`ALTER TABLE "finance_transaction" DROP CONSTRAINT IF EXISTS "ck_finance_txn_status"`);
    await q.query(`ALTER TABLE "finance_transaction" DROP COLUMN IF EXISTS "posted_at"`);
    await q.query(`ALTER TABLE "finance_transaction" DROP COLUMN IF EXISTS "status"`);
  }
}
