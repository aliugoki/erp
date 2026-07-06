import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, disableTenantRlsSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Employee expense claims (reimbursements). A claim is raised by/for an employee with one or more
 * lines, goes through DRAFT → SUBMITTED → APPROVED/REJECTED → PAID, and (opt-in) posts to the GL when
 * paid: Dr each line's expense account / Cr the reimbursement cash·bank account. Tenant-scoped + RLS.
 * `branch_id` / `cost_center_id` tag the claim for branch / cost-center reporting. Lines are stored as
 * jsonb (`[{ description, amountMinor, expenseAccountId? }]`). Idempotent.
 */
export class ExpenseClaims1727600000000 implements MigrationInterface {
  name = 'ExpenseClaims1727600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('expense_claim', [
        `"claim_no" text NOT NULL`,
        '"employee_id" uuid NOT NULL',
        '"claim_date" date',
        `"title" text NOT NULL DEFAULT ''`,
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"total_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"branch_id" uuid',
        '"cost_center_id" uuid',
        `"lines" jsonb NOT NULL DEFAULT '[]'::jsonb`,
        '"decided_by" uuid',
        '"decided_at" timestamptz',
        '"decision_note" text',
        '"journal_id" uuid',
        '"paid_on" date',
        `CONSTRAINT "ck_expense_claim_status" CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','PAID'))`,
      ]),
    );
    await q.query(`ALTER TABLE "expense_claim" ADD CONSTRAINT "uq_expense_claim_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_expense_claim_status" ON "expense_claim" ("tenant_id","status")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_expense_claim_employee" ON "expense_claim" ("tenant_id","employee_id")`);
    // Composite FKs keep every reference tenant-local (branch/cost-center/journal nullable → SET NULL).
    await q.query(`ALTER TABLE "expense_claim" ADD CONSTRAINT "fk_expense_claim_employee"
      FOREIGN KEY ("tenant_id","employee_id") REFERENCES "hr_employee"("tenant_id","id") ON DELETE RESTRICT`);
    await q.query(`ALTER TABLE "expense_claim" ADD CONSTRAINT "fk_expense_claim_branch"
      FOREIGN KEY ("tenant_id","branch_id") REFERENCES "branch"("tenant_id","id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "expense_claim" ADD CONSTRAINT "fk_expense_claim_cost_center"
      FOREIGN KEY ("tenant_id","cost_center_id") REFERENCES "cost_center"("tenant_id","id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "expense_claim" ADD CONSTRAINT "fk_expense_claim_journal"
      FOREIGN KEY ("tenant_id","journal_id") REFERENCES "finance_transaction"("tenant_id","id") ON DELETE SET NULL`);
    for (const stmt of enableTenantRlsSql('expense_claim')) await q.query(stmt);
    await q.query(grantAppUserSql('expense_claim'));
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const stmt of disableTenantRlsSql('expense_claim')) await q.query(stmt);
    await q.query(`DROP TABLE IF EXISTS "expense_claim" CASCADE`);
  }
}
