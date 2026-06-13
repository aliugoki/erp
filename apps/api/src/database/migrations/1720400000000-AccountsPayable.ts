import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Accounts Payable: vendors, their bills (purchase invoices), and payments against those bills.
 * Mirrors the AR/invoices sub-ledger (tenant-scoped RLS, composite (tenant_id, id) FKs, money as
 * bigint minor units). A bill tracks amount_paid_minor + a status; a payment increments it.
 */
export class AccountsPayable1720400000000 implements MigrationInterface {
  name = 'AccountsPayable1720400000000';

  public async up(q: QueryRunner): Promise<void> {
    // Vendors
    await q.query(
      createTenantTableSql('vendor', [
        '"name" text NOT NULL',
        '"email" text',
        '"phone" text',
      ]),
    );
    await q.query(`ALTER TABLE "vendor" ADD CONSTRAINT "uq_vendor_tenant_id" UNIQUE ("tenant_id","id")`);

    // Vendor bills (purchase invoices)
    await q.query(
      createTenantTableSql('vendor_bill', [
        '"number" text NOT NULL',
        '"vendor_id" uuid NOT NULL',
        `"line_items" jsonb NOT NULL DEFAULT '[]'`,
        '"subtotal_minor" bigint NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"amount_paid_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        `"status" text NOT NULL DEFAULT 'RECEIVED'`,
        '"bill_date" date NOT NULL DEFAULT current_date',
        '"due_date" date',
      ]),
    );
    await q.query(`ALTER TABLE "vendor_bill" ADD CONSTRAINT "uq_vendor_bill_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_vendor_bill_number" ON "vendor_bill" ("tenant_id", lower("number"))`);
    await q.query(`CREATE INDEX "ix_vendor_bill_vendor" ON "vendor_bill" ("tenant_id","vendor_id")`);
    await q.query(`CREATE INDEX "ix_vendor_bill_status" ON "vendor_bill" ("tenant_id","status")`);
    await q.query(
      `ALTER TABLE "vendor_bill" ADD CONSTRAINT "ck_vendor_bill_status"
       CHECK ("status" IN ('DRAFT','RECEIVED','PARTIALLY_PAID','PAID','VOID'))`,
    );
    await q.query(
      `ALTER TABLE "vendor_bill" ADD CONSTRAINT "ck_vendor_bill_paid_nonneg" CHECK ("amount_paid_minor" >= 0)`,
    );
    await q.query(
      `ALTER TABLE "vendor_bill" ADD CONSTRAINT "fk_vendor_bill_vendor"
       FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "vendor"("tenant_id","id") ON DELETE RESTRICT`,
    );

    // Payments against a bill
    await q.query(
      createTenantTableSql('bill_payment', [
        '"bill_id" uuid NOT NULL',
        '"amount_minor" bigint NOT NULL',
        '"paid_on" date NOT NULL DEFAULT current_date',
        '"method" text',
      ]),
    );
    await q.query(`CREATE INDEX "ix_bill_payment_bill" ON "bill_payment" ("tenant_id","bill_id")`);
    await q.query(`ALTER TABLE "bill_payment" ADD CONSTRAINT "ck_bill_payment_pos" CHECK ("amount_minor" > 0)`);
    await q.query(
      `ALTER TABLE "bill_payment" ADD CONSTRAINT "fk_bill_payment_bill"
       FOREIGN KEY ("tenant_id","bill_id") REFERENCES "vendor_bill"("tenant_id","id") ON DELETE CASCADE`,
    );

    for (const table of ['vendor', 'vendor_bill', 'bill_payment']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['bill_payment', 'vendor_bill', 'vendor']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
