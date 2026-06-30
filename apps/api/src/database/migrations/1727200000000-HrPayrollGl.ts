import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Integrates HR payroll with the general ledger. `hr_payroll_gl_config` maps the accounts an approved
 * payroll run posts to (one row per tenant). When configured, the HrPayrollGlConsumer turns each
 * `hr.payroll_run_completed` event into a journal voucher:
 *   Dr salary expense (gross)
 *   Cr statutory/deductions payable (deductions)   — only when a deductions account is set
 *   Cr salaries payable / net pay (gross − deductions credited)
 * Always balanced (Σ debit = gross = Σ credit). Expense + payable accounts are the minimum to post;
 * GL posting is opt-in (unset accounts → the run is skipped). `hr_payroll_run.journal_id` links the
 * run to the voucher it posted (and doubles as an idempotency guard). Idempotent.
 */
export class HrPayrollGl1727200000000 implements MigrationInterface {
  name = 'HrPayrollGl1727200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('hr_payroll_gl_config', [
        '"salary_expense_account_id" uuid',
        '"salary_payable_account_id" uuid',
        '"deductions_payable_account_id" uuid',
      ]),
    );
    await q.query(`ALTER TABLE "hr_payroll_gl_config" ADD CONSTRAINT "uq_hr_payroll_gl_config_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_hr_payroll_gl_config_tenant" ON "hr_payroll_gl_config" ("tenant_id")`);
    for (const col of ['salary_expense', 'salary_payable', 'deductions_payable']) {
      await q.query(`ALTER TABLE "hr_payroll_gl_config" ADD CONSTRAINT "fk_hr_payroll_gl_${col}"
        FOREIGN KEY ("tenant_id","${col}_account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE SET NULL`);
    }
    for (const stmt of enableTenantRlsSql('hr_payroll_gl_config')) await q.query(stmt);
    await q.query(grantAppUserSql('hr_payroll_gl_config'));

    // Link an approved run to the voucher it posted (also the per-run idempotency guard).
    await q.query(`ALTER TABLE "hr_payroll_run" ADD COLUMN IF NOT EXISTS "journal_id" uuid`);
    await q.query(`ALTER TABLE "hr_payroll_run" ADD COLUMN IF NOT EXISTS "journal_voucher_no" text`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_hr_payroll_run_journal') THEN
          ALTER TABLE "hr_payroll_run" ADD CONSTRAINT "fk_hr_payroll_run_journal"
            FOREIGN KEY ("tenant_id","journal_id") REFERENCES "finance_transaction"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "hr_payroll_run" DROP CONSTRAINT IF EXISTS "fk_hr_payroll_run_journal"`);
    await q.query(`ALTER TABLE "hr_payroll_run" DROP COLUMN IF EXISTS "journal_voucher_no"`);
    await q.query(`ALTER TABLE "hr_payroll_run" DROP COLUMN IF EXISTS "journal_id"`);
    await q.query(`DROP TABLE IF EXISTS "hr_payroll_gl_config" CASCADE`);
  }
}
