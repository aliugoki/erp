import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Enterprise HCM: leave management, payroll, performance and the employee lifecycle on top of the
 * core HR module (employees/departments/positions/attendance).
 *
 * - Leave: `hr_leave_type` (entitlement catalogue) → `hr_leave_balance` (per employee/type/year) →
 *   `hr_leave_request` (numbered, PENDING→APPROVED/REJECTED/CANCELLED; approval consumes balance).
 * - Payroll: `hr_salary_component` (EARNING/DEDUCTION, FIXED or % of basic) drives a `hr_payroll_run`
 *   (one per month) that materialises a `hr_payslip` (+ `hr_payslip_line`) per active employee.
 * - Performance: `hr_performance_review` (1–5 rating) and `hr_goal` (progress 0–100).
 * - Lifecycle: `hr_employment_history` (hire/promote/transfer/… audit) and `hr_document` (file refs).
 *
 * Document numbers come from `hr_doc_seq` (per-tenant, per-type). Money is bigint minor units; FKs are
 * composite (tenant_id, id); RLS on every table. Idempotent: creates run once via the migration ledger.
 */
export class HrEnterprise1722100000000 implements MigrationInterface {
  name = 'HrEnterprise1722100000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Per-tenant document numbering ───────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "hr_doc_seq" (
        "tenant_id" uuid NOT NULL,
        "doc_type" text NOT NULL,
        "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id", "doc_type")
      )
    `);
    for (const stmt of enableTenantRlsSql('hr_doc_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('hr_doc_seq'));

    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fkEmployee = (t: string, onDelete = 'CASCADE') =>
      q.query(
        `ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_employee"
         FOREIGN KEY ("tenant_id","employee_id") REFERENCES "hr_employee"("tenant_id","id") ON DELETE ${onDelete}`,
      );

    // ── Leave management ────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('hr_leave_type', [
        '"name" text NOT NULL',
        '"code" text',
        '"days_per_year" integer NOT NULL DEFAULT 0',
        '"paid" boolean NOT NULL DEFAULT true',
        '"color" text',
      ]),
    );
    await uq('hr_leave_type');

    await q.query(
      createTenantTableSql('hr_leave_balance', [
        '"employee_id" uuid NOT NULL',
        '"leave_type_id" uuid NOT NULL',
        '"year" integer NOT NULL',
        '"entitled_days" integer NOT NULL DEFAULT 0',
        '"used_days" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('hr_leave_balance');
    await q.query(
      `CREATE UNIQUE INDEX "uq_hr_leave_balance_unique" ON "hr_leave_balance" ("tenant_id","employee_id","leave_type_id","year")`,
    );
    await fkEmployee('hr_leave_balance');
    await q.query(
      `ALTER TABLE "hr_leave_balance" ADD CONSTRAINT "fk_hr_leave_balance_type"
       FOREIGN KEY ("tenant_id","leave_type_id") REFERENCES "hr_leave_type"("tenant_id","id") ON DELETE CASCADE`,
    );

    await q.query(
      createTenantTableSql('hr_leave_request', [
        '"leave_no" text NOT NULL',
        '"employee_id" uuid NOT NULL',
        '"leave_type_id" uuid NOT NULL',
        '"start_date" date NOT NULL',
        '"end_date" date NOT NULL',
        '"days" integer NOT NULL',
        '"reason" text',
        `"status" text NOT NULL DEFAULT 'PENDING'`,
        '"approver_id" uuid',
        '"decided_at" timestamptz',
        '"decision_note" text',
      ]),
    );
    await uq('hr_leave_request');
    await q.query(
      `ALTER TABLE "hr_leave_request" ADD CONSTRAINT "ck_hr_leave_request_status" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CANCELLED'))`,
    );
    await q.query(`ALTER TABLE "hr_leave_request" ADD CONSTRAINT "ck_hr_leave_request_days" CHECK ("days" > 0)`);
    await q.query(`CREATE INDEX "ix_hr_leave_request_status" ON "hr_leave_request" ("tenant_id","status")`);
    await q.query(`CREATE INDEX "ix_hr_leave_request_employee" ON "hr_leave_request" ("tenant_id","employee_id")`);
    await fkEmployee('hr_leave_request');
    await q.query(
      `ALTER TABLE "hr_leave_request" ADD CONSTRAINT "fk_hr_leave_request_type"
       FOREIGN KEY ("tenant_id","leave_type_id") REFERENCES "hr_leave_type"("tenant_id","id") ON DELETE CASCADE`,
    );

    // ── Payroll ─────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('hr_salary_component', [
        '"name" text NOT NULL',
        '"code" text NOT NULL',
        `"type" text NOT NULL`,
        `"calc" text NOT NULL`,
        '"value_minor" bigint NOT NULL DEFAULT 0',
        '"percent" integer NOT NULL DEFAULT 0',
        '"active" boolean NOT NULL DEFAULT true',
      ]),
    );
    await uq('hr_salary_component');
    await q.query(`CREATE UNIQUE INDEX "uq_hr_salary_component_code" ON "hr_salary_component" ("tenant_id", lower("code"))`);
    await q.query(`ALTER TABLE "hr_salary_component" ADD CONSTRAINT "ck_hr_salary_component_type" CHECK ("type" IN ('EARNING','DEDUCTION'))`);
    await q.query(`ALTER TABLE "hr_salary_component" ADD CONSTRAINT "ck_hr_salary_component_calc" CHECK ("calc" IN ('FIXED','PCT_OF_BASIC'))`);
    await q.query(`ALTER TABLE "hr_salary_component" ADD CONSTRAINT "ck_hr_salary_component_percent" CHECK ("percent" BETWEEN 0 AND 100)`);

    await q.query(
      createTenantTableSql('hr_payroll_run', [
        '"run_no" text NOT NULL',
        '"period_year" integer NOT NULL',
        '"period_month" integer NOT NULL',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"total_gross_minor" bigint NOT NULL DEFAULT 0',
        '"total_deduction_minor" bigint NOT NULL DEFAULT 0',
        '"total_net_minor" bigint NOT NULL DEFAULT 0',
        '"employee_count" integer NOT NULL DEFAULT 0',
        '"run_at" timestamptz',
      ]),
    );
    await uq('hr_payroll_run');
    await q.query(`ALTER TABLE "hr_payroll_run" ADD CONSTRAINT "ck_hr_payroll_run_status" CHECK ("status" IN ('DRAFT','APPROVED','PAID'))`);
    await q.query(`ALTER TABLE "hr_payroll_run" ADD CONSTRAINT "ck_hr_payroll_run_month" CHECK ("period_month" BETWEEN 1 AND 12)`);
    await q.query(`CREATE UNIQUE INDEX "uq_hr_payroll_run_period" ON "hr_payroll_run" ("tenant_id","period_year","period_month")`);

    await q.query(
      createTenantTableSql('hr_payslip', [
        '"payslip_no" text NOT NULL',
        '"run_id" uuid NOT NULL',
        '"employee_id" uuid NOT NULL',
        '"basic_minor" bigint NOT NULL DEFAULT 0',
        '"gross_minor" bigint NOT NULL DEFAULT 0',
        '"deduction_minor" bigint NOT NULL DEFAULT 0',
        '"net_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
      ]),
    );
    await uq('hr_payslip');
    await q.query(`CREATE INDEX "ix_hr_payslip_run" ON "hr_payslip" ("tenant_id","run_id")`);
    await q.query(`CREATE INDEX "ix_hr_payslip_employee" ON "hr_payslip" ("tenant_id","employee_id")`);
    await q.query(
      `ALTER TABLE "hr_payslip" ADD CONSTRAINT "fk_hr_payslip_run"
       FOREIGN KEY ("tenant_id","run_id") REFERENCES "hr_payroll_run"("tenant_id","id") ON DELETE CASCADE`,
    );
    await fkEmployee('hr_payslip');

    await q.query(
      createTenantTableSql('hr_payslip_line', [
        '"payslip_id" uuid NOT NULL',
        '"code" text',
        '"name" text NOT NULL',
        `"type" text NOT NULL`,
        '"amount_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('hr_payslip_line');
    await q.query(`CREATE INDEX "ix_hr_payslip_line_payslip" ON "hr_payslip_line" ("tenant_id","payslip_id")`);
    await q.query(
      `ALTER TABLE "hr_payslip_line" ADD CONSTRAINT "fk_hr_payslip_line_payslip"
       FOREIGN KEY ("tenant_id","payslip_id") REFERENCES "hr_payslip"("tenant_id","id") ON DELETE CASCADE`,
    );

    // ── Performance ─────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('hr_performance_review', [
        '"review_no" text NOT NULL',
        '"employee_id" uuid NOT NULL',
        '"period" text NOT NULL',
        '"reviewer_id" uuid',
        '"rating" integer',
        '"strengths" text',
        '"improvements" text',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"submitted_at" timestamptz',
      ]),
    );
    await uq('hr_performance_review');
    await q.query(`ALTER TABLE "hr_performance_review" ADD CONSTRAINT "ck_hr_review_rating" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5)`);
    await q.query(`ALTER TABLE "hr_performance_review" ADD CONSTRAINT "ck_hr_review_status" CHECK ("status" IN ('DRAFT','SUBMITTED','ACKNOWLEDGED'))`);
    await q.query(`CREATE INDEX "ix_hr_review_employee" ON "hr_performance_review" ("tenant_id","employee_id")`);
    await fkEmployee('hr_performance_review');

    await q.query(
      createTenantTableSql('hr_goal', [
        '"employee_id" uuid NOT NULL',
        '"title" text NOT NULL',
        '"description" text',
        '"target_date" date',
        `"status" text NOT NULL DEFAULT 'NOT_STARTED'`,
        '"progress" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('hr_goal');
    await q.query(`ALTER TABLE "hr_goal" ADD CONSTRAINT "ck_hr_goal_status" CHECK ("status" IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','CANCELLED'))`);
    await q.query(`ALTER TABLE "hr_goal" ADD CONSTRAINT "ck_hr_goal_progress" CHECK ("progress" BETWEEN 0 AND 100)`);
    await q.query(`CREATE INDEX "ix_hr_goal_employee" ON "hr_goal" ("tenant_id","employee_id")`);
    await fkEmployee('hr_goal');

    // ── Lifecycle ───────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('hr_employment_history', [
        '"employee_id" uuid NOT NULL',
        `"event_type" text NOT NULL`,
        '"effective_date" date NOT NULL DEFAULT current_date',
        '"detail" text',
        '"from_value" text',
        '"to_value" text',
      ]),
    );
    await uq('hr_employment_history');
    await q.query(`CREATE INDEX "ix_hr_employment_history_employee" ON "hr_employment_history" ("tenant_id","employee_id","effective_date")`);
    await fkEmployee('hr_employment_history');

    await q.query(
      createTenantTableSql('hr_document', [
        '"employee_id" uuid NOT NULL',
        '"doc_type" text',
        '"title" text NOT NULL',
        '"file_ref" text',
        '"note" text',
      ]),
    );
    await uq('hr_document');
    await q.query(`CREATE INDEX "ix_hr_document_employee" ON "hr_document" ("tenant_id","employee_id")`);
    await fkEmployee('hr_document');

    const tables = [
      'hr_leave_type', 'hr_leave_balance', 'hr_leave_request',
      'hr_salary_component', 'hr_payroll_run', 'hr_payslip', 'hr_payslip_line',
      'hr_performance_review', 'hr_goal', 'hr_employment_history', 'hr_document',
    ];
    for (const table of tables) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const tables = [
      'hr_document', 'hr_employment_history', 'hr_goal', 'hr_performance_review',
      'hr_payslip_line', 'hr_payslip', 'hr_payroll_run', 'hr_salary_component',
      'hr_leave_request', 'hr_leave_balance', 'hr_leave_type', 'hr_doc_seq',
    ];
    for (const table of tables) await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}
