import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GL-post the AR sub-ledger: link an invoice to the journal voucher it posts, and give each CRM
 * client a receivable ledger account (created lazily on first GL-posted invoice, under the
 * RECEIVABLE control). Both nullable — GL posting is opt-in, so existing flows are unaffected.
 */
export class ArGlPosting1721200000000 implements MigrationInterface {
  name = 'ArGlPosting1721200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "finance_invoice" ADD COLUMN IF NOT EXISTS "journal_id" uuid`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_finance_invoice_journal') THEN
          ALTER TABLE "finance_invoice" ADD CONSTRAINT "fk_finance_invoice_journal"
            FOREIGN KEY ("tenant_id","journal_id") REFERENCES "finance_transaction"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await q.query(`ALTER TABLE "crm_client" ADD COLUMN IF NOT EXISTS "account_id" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_crm_client_account" ON "crm_client" ("tenant_id","account_id")`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_client_account') THEN
          ALTER TABLE "crm_client" ADD CONSTRAINT "fk_crm_client_account"
            FOREIGN KEY ("tenant_id","account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "crm_client" DROP CONSTRAINT IF EXISTS "fk_crm_client_account"`);
    await q.query(`DROP INDEX IF EXISTS "ix_crm_client_account"`);
    await q.query(`ALTER TABLE "crm_client" DROP COLUMN IF EXISTS "account_id"`);
    await q.query(`ALTER TABLE "finance_invoice" DROP CONSTRAINT IF EXISTS "fk_finance_invoice_journal"`);
    await q.query(`ALTER TABLE "finance_invoice" DROP COLUMN IF EXISTS "journal_id"`);
  }
}
