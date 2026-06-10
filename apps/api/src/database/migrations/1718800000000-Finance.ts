import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Finance module schema (Chunk 3.2). Double-entry safe: journal entries carry integer minor-unit
 * debit/credit (a line is debit XOR credit, enforced by CHECK); the per-transaction balance
 * (sum debit = sum credit) is enforced in the service. All money is bigint minor units + currency
 * (ADR-007) — never a float. Tenant-scoped (RLS), composite (tenant_id, id) FKs.
 */
export class Finance1718800000000 implements MigrationInterface {
  name = 'Finance1718800000000';

  public async up(q: QueryRunner): Promise<void> {
    // Chart of accounts
    await q.query(
      createTenantTableSql('finance_account', [
        '"code" text NOT NULL',
        '"name" text NOT NULL',
        `"type" text NOT NULL`,
      ]),
    );
    await q.query(`ALTER TABLE "finance_account" ADD CONSTRAINT "uq_finance_account_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_finance_account_code" ON "finance_account" ("tenant_id", lower("code"))`);
    await q.query(
      `ALTER TABLE "finance_account" ADD CONSTRAINT "ck_finance_account_type"
       CHECK ("type" IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'))`,
    );

    // Transactions (header)
    await q.query(
      createTenantTableSql('finance_transaction', [
        '"description" text NOT NULL',
        '"occurred_on" date NOT NULL DEFAULT current_date',
        '"reference" text',
      ]),
    );
    await q.query(`ALTER TABLE "finance_transaction" ADD CONSTRAINT "uq_finance_transaction_tenant_id" UNIQUE ("tenant_id","id")`);

    // Journal entries (lines)
    await q.query(
      createTenantTableSql('finance_journal_entry', [
        '"transaction_id" uuid NOT NULL',
        '"account_id" uuid NOT NULL',
        '"debit_minor" bigint NOT NULL DEFAULT 0',
        '"credit_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
      ]),
    );
    await q.query(`ALTER TABLE "finance_journal_entry" ADD CONSTRAINT "uq_finance_journal_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(
      `ALTER TABLE "finance_journal_entry" ADD CONSTRAINT "ck_finance_journal_nonneg"
       CHECK ("debit_minor" >= 0 AND "credit_minor" >= 0)`,
    );
    // A line is a debit OR a credit, not both.
    await q.query(
      `ALTER TABLE "finance_journal_entry" ADD CONSTRAINT "ck_finance_journal_xor"
       CHECK (NOT ("debit_minor" > 0 AND "credit_minor" > 0))`,
    );
    await q.query(`CREATE INDEX "ix_finance_journal_txn" ON "finance_journal_entry" ("tenant_id","transaction_id")`);
    await q.query(
      `ALTER TABLE "finance_journal_entry" ADD CONSTRAINT "fk_finance_journal_txn"
       FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "finance_transaction"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "finance_journal_entry" ADD CONSTRAINT "fk_finance_journal_account"
       FOREIGN KEY ("tenant_id","account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE RESTRICT`,
    );

    // Invoices
    await q.query(
      createTenantTableSql('finance_invoice', [
        '"number" text NOT NULL',
        '"client_id" uuid',
        `"line_items" jsonb NOT NULL DEFAULT '[]'`,
        '"subtotal_minor" bigint NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"due_date" date',
        '"paid_at" timestamptz',
      ]),
    );
    await q.query(`ALTER TABLE "finance_invoice" ADD CONSTRAINT "uq_finance_invoice_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_finance_invoice_number" ON "finance_invoice" ("tenant_id", lower("number"))`);
    await q.query(`CREATE INDEX "ix_finance_invoice_status" ON "finance_invoice" ("tenant_id","status")`);
    await q.query(`CREATE INDEX "ix_finance_invoice_client" ON "finance_invoice" ("tenant_id","client_id")`);
    await q.query(
      `ALTER TABLE "finance_invoice" ADD CONSTRAINT "ck_finance_invoice_status"
       CHECK ("status" IN ('DRAFT','SENT','PAID','VOID'))`,
    );

    for (const table of ['finance_account', 'finance_transaction', 'finance_journal_entry', 'finance_invoice']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['finance_journal_entry', 'finance_transaction', 'finance_invoice', 'finance_account']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
