import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-department salary expense account for payroll GL posting. `hr_department.salary_expense_account_id`
 * (nullable, composite FK to finance_account) lets a department override the tenant-level default
 * salary-expense account in `hr_payroll_gl_config`, so an approved payroll run debits each department's
 * gross to its own expense account (unmapped departments fall back to the default). Idempotent.
 */
export class DepartmentSalaryAccount1727300000000 implements MigrationInterface {
  name = 'DepartmentSalaryAccount1727300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "hr_department" ADD COLUMN IF NOT EXISTS "salary_expense_account_id" uuid`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_hr_department_salary_expense') THEN
          ALTER TABLE "hr_department" ADD CONSTRAINT "fk_hr_department_salary_expense"
            FOREIGN KEY ("tenant_id","salary_expense_account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "hr_department" DROP CONSTRAINT IF EXISTS "fk_hr_department_salary_expense"`);
    await q.query(`ALTER TABLE "hr_department" DROP COLUMN IF EXISTS "salary_expense_account_id"`);
  }
}
