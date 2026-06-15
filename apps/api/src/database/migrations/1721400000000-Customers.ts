import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Customers — the AR counterpart of `vendor`. A customer is a billable party in the invoices module;
 * like a vendor it gets its own RECEIVABLE ledger sub-account (so it shows in the chart of accounts),
 * and an invoice links to a customer. Mirrors the vendor table (tenant-scoped RLS, (tenant_id,id) FK).
 *
 * Idempotent: guarded so a re-run is a no-op (table create is unconditional but only runs once because
 * the migration ledger records it; the invoice column + FK use IF NOT EXISTS / DO-block guards).
 */
export class Customers1721400000000 implements MigrationInterface {
  name = 'Customers1721400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('customer', [
        '"name" text NOT NULL',
        '"email" text',
        '"phone" text',
        '"account_id" uuid',
      ]),
    );
    await q.query(`ALTER TABLE "customer" ADD CONSTRAINT "uq_customer_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_customer_account" ON "customer" ("tenant_id","account_id")`);
    for (const stmt of enableTenantRlsSql('customer')) await q.query(stmt);
    await q.query(grantAppUserSql('customer'));

    // Link invoices to a customer (the receivable subsidiary). Nullable for back-compat with crm-client invoices.
    await q.query(`ALTER TABLE "finance_invoice" ADD COLUMN IF NOT EXISTS "customer_id" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_finance_invoice_customer" ON "finance_invoice" ("tenant_id","customer_id")`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_finance_invoice_customer') THEN
          ALTER TABLE "finance_invoice" ADD CONSTRAINT "fk_finance_invoice_customer"
            FOREIGN KEY ("tenant_id","customer_id") REFERENCES "customer"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "finance_invoice" DROP CONSTRAINT IF EXISTS "fk_finance_invoice_customer"`);
    await q.query(`DROP INDEX IF EXISTS "ix_finance_invoice_customer"`);
    await q.query(`ALTER TABLE "finance_invoice" DROP COLUMN IF EXISTS "customer_id"`);
    await q.query(`DROP TABLE IF EXISTS "customer" CASCADE`);
  }
}
