import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Imported bank-statement lines for reconciliation. `amount_minor` is signed (+ deposit / − payment,
 * i.e. the debit-positive effect on the bank account). Auto-match links a line to an unreconciled
 * journal entry on that account and flags the entry reconciled.
 */
export class BankStatements1720900000000 implements MigrationInterface {
  name = 'BankStatements1720900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('bank_statement_line', [
        '"account_id" uuid NOT NULL',
        '"stmt_date" date NOT NULL',
        '"description" text',
        '"amount_minor" bigint NOT NULL',
        '"reference" text',
        '"matched_entry_id" uuid',
      ]),
    );
    await q.query(`CREATE INDEX "ix_bank_stmt_account" ON "bank_statement_line" ("tenant_id","account_id","matched_entry_id")`);
    await q.query(
      `ALTER TABLE "bank_statement_line" ADD CONSTRAINT "fk_bank_stmt_account"
       FOREIGN KEY ("tenant_id","account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "bank_statement_line" ADD CONSTRAINT "fk_bank_stmt_entry"
       FOREIGN KEY ("tenant_id","matched_entry_id") REFERENCES "finance_journal_entry"("tenant_id","id") ON DELETE SET NULL`,
    );
    for (const stmt of enableTenantRlsSql('bank_statement_line')) await q.query(stmt);
    await q.query(grantAppUserSql('bank_statement_line'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "bank_statement_line" CASCADE`);
  }
}
