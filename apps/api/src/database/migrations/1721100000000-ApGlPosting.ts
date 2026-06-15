import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Link a vendor bill and each bill payment to the journal voucher they post to the GL, so the AP
 * sub-ledger reflects into the general ledger (Dr expense / Cr vendor-payable on a bill; Dr
 * vendor-payable / Cr cash·bank on a payment). Nullable — GL posting is opt-in (only when an expense
 * / payment account is supplied), so existing flows are unaffected.
 */
export class ApGlPosting1721100000000 implements MigrationInterface {
  name = 'ApGlPosting1721100000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of ['vendor_bill', 'bill_payment']) {
      await q.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "journal_id" uuid`);
      await q.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_${table}_journal') THEN
            ALTER TABLE "${table}" ADD CONSTRAINT "fk_${table}_journal"
              FOREIGN KEY ("tenant_id","journal_id") REFERENCES "finance_transaction"("tenant_id","id") ON DELETE SET NULL;
          END IF;
        END $$;
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['vendor_bill', 'bill_payment']) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "fk_${table}_journal"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "journal_id"`);
    }
  }
}
