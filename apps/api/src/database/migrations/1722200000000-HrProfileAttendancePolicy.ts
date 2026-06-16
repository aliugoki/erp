import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * HR depth pass: complete employee profiles, an enterprise attendance module that feeds payroll, and a
 * configurable policy module with company-defined custom fields.
 *
 * - Employee profile: `hr_employee` gains personal/contact/job columns (DOB, gender, CNIC, address,
 *   emergency contact, designation, employment type, reporting line, …) plus child tables
 *   `hr_employee_education` and `hr_employee_experience`.
 * - Attendance: `hr_attendance` gains work/overtime hours, a late flag and notes, and a per-day unique
 *   index so daily logging upserts. Payroll learns about it: `hr_payroll_run.working_days` and
 *   `hr_payslip.working_days`/`payable_days` let the run pro-rate basic pay by attendance.
 * - Policy: `hr_custom_field` (company-defined fields, EAV) → `hr_policy` → `hr_policy_field_value`,
 *   so each tenant shapes policies with its own fields.
 *
 * RLS + composite (tenant_id, id) FKs on every new table; money stays bigint minor units.
 */
export class HrProfileAttendancePolicy1722200000000 implements MigrationInterface {
  name = 'HrProfileAttendancePolicy1722200000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Employee profile columns ────────────────────────────────────────────────
    for (const col of [
      '"date_of_birth" date',
      '"gender" text',
      '"marital_status" text',
      '"national_id" text',
      '"blood_group" text',
      '"nationality" text',
      '"address" text',
      '"city" text',
      '"country" text',
      '"emergency_contact_name" text',
      '"emergency_contact_phone" text',
      '"designation" text',
      '"employment_type" text',
      '"reporting_to" uuid',
      '"confirmation_date" date',
      '"work_location" text',
      '"photo_ref" text',
    ]) {
      await q.query(`ALTER TABLE "hr_employee" ADD COLUMN IF NOT EXISTS ${col}`);
    }
    await q.query(`ALTER TABLE "hr_employee" DROP CONSTRAINT IF EXISTS "ck_hr_employee_gender"`);
    await q.query(`ALTER TABLE "hr_employee" ADD CONSTRAINT "ck_hr_employee_gender" CHECK ("gender" IS NULL OR "gender" IN ('MALE','FEMALE','OTHER'))`);
    await q.query(`ALTER TABLE "hr_employee" DROP CONSTRAINT IF EXISTS "ck_hr_employee_employment_type"`);
    await q.query(`ALTER TABLE "hr_employee" ADD CONSTRAINT "ck_hr_employee_employment_type" CHECK ("employment_type" IS NULL OR "employment_type" IN ('FULL_TIME','PART_TIME','CONTRACT','INTERN','PROBATION'))`);
    await q.query(
      `ALTER TABLE "hr_employee" ADD CONSTRAINT "fk_hr_employee_reporting_to"
       FOREIGN KEY ("tenant_id","reporting_to") REFERENCES "hr_employee"("tenant_id","id") ON DELETE SET NULL`,
    );

    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fkEmployee = (t: string) =>
      q.query(
        `ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_employee"
         FOREIGN KEY ("tenant_id","employee_id") REFERENCES "hr_employee"("tenant_id","id") ON DELETE CASCADE`,
      );

    await q.query(
      createTenantTableSql('hr_employee_education', [
        '"employee_id" uuid NOT NULL',
        '"degree" text NOT NULL',
        '"institution" text',
        '"field_of_study" text',
        '"start_year" integer',
        '"end_year" integer',
        '"grade" text',
      ]),
    );
    await uq('hr_employee_education');
    await q.query(`CREATE INDEX "ix_hr_education_employee" ON "hr_employee_education" ("tenant_id","employee_id")`);
    await fkEmployee('hr_employee_education');

    await q.query(
      createTenantTableSql('hr_employee_experience', [
        '"employee_id" uuid NOT NULL',
        '"company" text NOT NULL',
        '"title" text',
        '"start_date" date',
        '"end_date" date',
        '"description" text',
      ]),
    );
    await uq('hr_employee_experience');
    await q.query(`CREATE INDEX "ix_hr_experience_employee" ON "hr_employee_experience" ("tenant_id","employee_id")`);
    await fkEmployee('hr_employee_experience');

    // ── Attendance enhancements ─────────────────────────────────────────────────
    for (const col of [
      '"work_hours" numeric(5,2)',
      '"overtime_hours" numeric(5,2)',
      '"late" boolean NOT NULL DEFAULT false',
      '"notes" text',
    ]) {
      await q.query(`ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS ${col}`);
    }
    // Drop any pre-existing same-day duplicates (live rows only), then enforce one record per day.
    await q.query(
      `DELETE FROM "hr_attendance" a USING "hr_attendance" b
       WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
         AND a.tenant_id=b.tenant_id AND a.employee_id=b.employee_id AND a.date=b.date AND a.ctid < b.ctid`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_hr_attendance_emp_date" ON "hr_attendance" ("tenant_id","employee_id","date") WHERE "deleted_at" IS NULL`,
    );
    await q.query(`ALTER TABLE "hr_attendance" DROP CONSTRAINT IF EXISTS "ck_hr_attendance_status"`);
    await q.query(`ALTER TABLE "hr_attendance" ADD CONSTRAINT "ck_hr_attendance_status" CHECK ("status" IN ('PRESENT','ABSENT','LEAVE','HALF_DAY'))`);

    // ── Payroll: attendance-aware ───────────────────────────────────────────────
    await q.query(`ALTER TABLE "hr_payroll_run" ADD COLUMN IF NOT EXISTS "working_days" integer NOT NULL DEFAULT 26`);
    await q.query(`ALTER TABLE "hr_payslip" ADD COLUMN IF NOT EXISTS "working_days" integer NOT NULL DEFAULT 26`);
    await q.query(`ALTER TABLE "hr_payslip" ADD COLUMN IF NOT EXISTS "payable_days" numeric(6,2) NOT NULL DEFAULT 0`);

    // ── Policy module with custom fields ────────────────────────────────────────
    await q.query(
      createTenantTableSql('hr_custom_field', [
        `"entity" text NOT NULL DEFAULT 'POLICY'`,
        '"label" text NOT NULL',
        '"field_key" text NOT NULL',
        `"field_type" text NOT NULL DEFAULT 'TEXT'`,
        '"options" jsonb',
        '"required" boolean NOT NULL DEFAULT false',
        '"sort_order" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('hr_custom_field');
    await q.query(`ALTER TABLE "hr_custom_field" ADD CONSTRAINT "ck_hr_custom_field_type" CHECK ("field_type" IN ('TEXT','NUMBER','DATE','BOOLEAN','SELECT'))`);
    await q.query(`CREATE UNIQUE INDEX "uq_hr_custom_field_key" ON "hr_custom_field" ("tenant_id","entity",lower("field_key"))`);

    await q.query(
      createTenantTableSql('hr_policy', [
        '"name" text NOT NULL',
        `"category" text NOT NULL DEFAULT 'OTHER'`,
        '"description" text',
        '"effective_date" date',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"version" integer NOT NULL DEFAULT 1',
      ]),
    );
    await uq('hr_policy');
    await q.query(`ALTER TABLE "hr_policy" ADD CONSTRAINT "ck_hr_policy_status" CHECK ("status" IN ('DRAFT','ACTIVE','ARCHIVED'))`);
    await q.query(`ALTER TABLE "hr_policy" ADD CONSTRAINT "ck_hr_policy_category" CHECK ("category" IN ('LEAVE','ATTENDANCE','CONDUCT','BENEFITS','PAYROLL','OTHER'))`);
    await q.query(`CREATE INDEX "ix_hr_policy_status" ON "hr_policy" ("tenant_id","status")`);

    await q.query(
      createTenantTableSql('hr_policy_field_value', [
        '"policy_id" uuid NOT NULL',
        '"field_id" uuid NOT NULL',
        '"value" text',
      ]),
    );
    await uq('hr_policy_field_value');
    await q.query(`CREATE UNIQUE INDEX "uq_hr_policy_field_value" ON "hr_policy_field_value" ("tenant_id","policy_id","field_id")`);
    await q.query(
      `ALTER TABLE "hr_policy_field_value" ADD CONSTRAINT "fk_hr_policy_field_value_policy"
       FOREIGN KEY ("tenant_id","policy_id") REFERENCES "hr_policy"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "hr_policy_field_value" ADD CONSTRAINT "fk_hr_policy_field_value_field"
       FOREIGN KEY ("tenant_id","field_id") REFERENCES "hr_custom_field"("tenant_id","id") ON DELETE CASCADE`,
    );

    for (const table of [
      'hr_employee_education', 'hr_employee_experience',
      'hr_custom_field', 'hr_policy', 'hr_policy_field_value',
    ]) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['hr_policy_field_value', 'hr_policy', 'hr_custom_field', 'hr_employee_experience', 'hr_employee_education']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await q.query(`DROP INDEX IF EXISTS "uq_hr_attendance_emp_date"`);
    for (const col of ['work_hours', 'overtime_hours', 'late', 'notes']) {
      await q.query(`ALTER TABLE "hr_attendance" DROP COLUMN IF EXISTS "${col}"`);
    }
    await q.query(`ALTER TABLE "hr_payslip" DROP COLUMN IF EXISTS "payable_days"`);
    await q.query(`ALTER TABLE "hr_payslip" DROP COLUMN IF EXISTS "working_days"`);
    await q.query(`ALTER TABLE "hr_payroll_run" DROP COLUMN IF EXISTS "working_days"`);
    await q.query(`ALTER TABLE "hr_employee" DROP CONSTRAINT IF EXISTS "fk_hr_employee_reporting_to"`);
    await q.query(`ALTER TABLE "hr_employee" DROP CONSTRAINT IF EXISTS "ck_hr_employee_gender"`);
    await q.query(`ALTER TABLE "hr_employee" DROP CONSTRAINT IF EXISTS "ck_hr_employee_employment_type"`);
    for (const col of [
      'date_of_birth', 'gender', 'marital_status', 'national_id', 'blood_group', 'nationality', 'address',
      'city', 'country', 'emergency_contact_name', 'emergency_contact_phone', 'designation',
      'employment_type', 'reporting_to', 'confirmation_date', 'work_location', 'photo_ref',
    ]) {
      await q.query(`ALTER TABLE "hr_employee" DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
