import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * HR module schema (Chunk 3.1). Every table is tenant-scoped (BaseEntity columns + RLS). Foreign keys
 * are COMPOSITE on (tenant_id, id) — FK validation bypasses RLS, so a plain id FK could point at
 * another tenant's row; including tenant_id makes cross-tenant references structurally impossible.
 * Salary is integer minor units + ISO currency (ADR-007), never a float.
 */
export class Hr1718600000000 implements MigrationInterface {
  name = 'Hr1718600000000';

  public async up(q: QueryRunner): Promise<void> {
    // --- positions ---
    await q.query(createTenantTableSql('hr_position', ['"title" text NOT NULL', '"description" text']));
    await q.query(`ALTER TABLE "hr_position" ADD CONSTRAINT "uq_hr_position_tenant_id" UNIQUE ("tenant_id","id")`);

    // --- departments (self-referencing tree) ---
    await q.query(
      createTenantTableSql('hr_department', [
        '"name" text NOT NULL',
        '"manager_id" uuid',
        '"parent_department_id" uuid',
      ]),
    );
    await q.query(`ALTER TABLE "hr_department" ADD CONSTRAINT "uq_hr_department_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(
      `ALTER TABLE "hr_department" ADD CONSTRAINT "fk_hr_department_parent"
       FOREIGN KEY ("tenant_id","parent_department_id") REFERENCES "hr_department"("tenant_id","id") ON DELETE SET NULL`,
    );

    // --- employees ---
    await q.query(
      createTenantTableSql('hr_employee', [
        '"employee_code" text NOT NULL',
        '"first_name" text NOT NULL',
        '"last_name" text NOT NULL',
        '"email" text',
        '"phone" text',
        '"department_id" uuid',
        '"position_id" uuid',
        '"join_date" date',
        '"salary_amount_minor" bigint',
        `"salary_currency" text NOT NULL DEFAULT 'PKR'`,
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
      ]),
    );
    await q.query(`ALTER TABLE "hr_employee" ADD CONSTRAINT "uq_hr_employee_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_hr_employee_code" ON "hr_employee" ("tenant_id", lower("employee_code"))`,
    );
    await q.query(`CREATE INDEX "ix_hr_employee_department" ON "hr_employee" ("tenant_id","department_id")`);
    await q.query(`CREATE INDEX "ix_hr_employee_status" ON "hr_employee" ("tenant_id","status")`);
    await q.query(
      `ALTER TABLE "hr_employee" ADD CONSTRAINT "fk_hr_employee_department"
       FOREIGN KEY ("tenant_id","department_id") REFERENCES "hr_department"("tenant_id","id") ON DELETE SET NULL`,
    );
    await q.query(
      `ALTER TABLE "hr_employee" ADD CONSTRAINT "fk_hr_employee_position"
       FOREIGN KEY ("tenant_id","position_id") REFERENCES "hr_position"("tenant_id","id") ON DELETE SET NULL`,
    );

    // --- attendance ---
    await q.query(
      createTenantTableSql('hr_attendance', [
        '"employee_id" uuid NOT NULL',
        '"date" date NOT NULL',
        '"check_in" timestamptz',
        '"check_out" timestamptz',
        `"status" text NOT NULL DEFAULT 'PRESENT'`,
      ]),
    );
    await q.query(`ALTER TABLE "hr_attendance" ADD CONSTRAINT "uq_hr_attendance_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX "ix_hr_attendance_employee" ON "hr_attendance" ("tenant_id","employee_id","date")`);
    await q.query(
      `ALTER TABLE "hr_attendance" ADD CONSTRAINT "fk_hr_attendance_employee"
       FOREIGN KEY ("tenant_id","employee_id") REFERENCES "hr_employee"("tenant_id","id") ON DELETE CASCADE`,
    );

    // RLS + grants on every table.
    for (const table of ['hr_position', 'hr_department', 'hr_employee', 'hr_attendance']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['hr_attendance', 'hr_employee', 'hr_department', 'hr_position']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
