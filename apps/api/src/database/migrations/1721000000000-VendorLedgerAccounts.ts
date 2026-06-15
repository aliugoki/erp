import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subsidiary ledger: link each vendor to its own ledger account in the chart of accounts, and let a
 * group account be designated the PAYABLE / RECEIVABLE control (the parent under which vendor /
 * customer sub-accounts are auto-created). Extends `finance_account.control_type` accordingly.
 */
export class VendorLedgerAccounts1721000000000 implements MigrationInterface {
  name = 'VendorLedgerAccounts1721000000000';

  public async up(q: QueryRunner): Promise<void> {
    // Widen the control-type CHECK (drop + re-add is idempotent; existing values are a subset).
    await q.query(`ALTER TABLE "finance_account" DROP CONSTRAINT IF EXISTS "ck_finance_account_control_type"`);
    await q.query(
      `ALTER TABLE "finance_account" ADD CONSTRAINT "ck_finance_account_control_type"
       CHECK ("control_type" IN ('NONE','CASH','BANK','PAYABLE','RECEIVABLE'))`,
    );

    await q.query(`ALTER TABLE "vendor" ADD COLUMN IF NOT EXISTS "account_id" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_vendor_account" ON "vendor" ("tenant_id","account_id")`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendor_account') THEN
          ALTER TABLE "vendor" ADD CONSTRAINT "fk_vendor_account"
            FOREIGN KEY ("tenant_id","account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor" DROP CONSTRAINT IF EXISTS "fk_vendor_account"`);
    await q.query(`DROP INDEX IF EXISTS "ix_vendor_account"`);
    await q.query(`ALTER TABLE "vendor" DROP COLUMN IF EXISTS "account_id"`);
    await q.query(`ALTER TABLE "finance_account" DROP CONSTRAINT IF EXISTS "ck_finance_account_control_type"`);
    await q.query(
      `ALTER TABLE "finance_account" ADD CONSTRAINT "ck_finance_account_control_type"
       CHECK ("control_type" IN ('NONE','CASH','BANK'))`,
    );
  }
}
