import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Project Management & Timesheets. A `project` (for a crm_client, run by an hr_employee manager) has
 * `project_member`s (each with an hourly cost + bill rate), `project_task`s, `project_time_entry`s
 * (logged in minutes → submitted → approved, costed + billed from the member's rates), and
 * `project_expense`s. Project costing rolls up labour + expenses vs the budget. Tenant-scoped (RLS);
 * money is integer minor units; numbers from `project_doc_seq`.
 */
export class Projects1723800000000 implements MigrationInterface {
  name = 'Projects1723800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "project_doc_seq" (
        "tenant_id" uuid NOT NULL, "doc_type" text NOT NULL, "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id","doc_type"))`);
    for (const stmt of enableTenantRlsSql('project_doc_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('project_doc_seq'));

    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fkEmployee = (t: string, col: string, name: string) =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${name}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "hr_employee"("tenant_id","id") ON DELETE SET NULL`);
    const fkProject = (t: string, name: string) =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${name}"
        FOREIGN KEY ("tenant_id","project_id") REFERENCES "project"("tenant_id","id") ON DELETE CASCADE`);

    // ── Projects ────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('project', [
        '"project_no" text NOT NULL',
        '"name" text NOT NULL',
        '"code" text',
        '"client_id" uuid',
        '"manager_employee_id" uuid',
        `"status" text NOT NULL DEFAULT 'PLANNED'`,
        `"billing_type" text NOT NULL DEFAULT 'TIME_MATERIALS'`,
        '"start_date" date',
        '"end_date" date',
        '"budget_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"description" text',
      ]),
    );
    await uq('project');
    await q.query(`ALTER TABLE "project" ADD CONSTRAINT "ck_project_status" CHECK ("status" IN ('PLANNED','ACTIVE','ON_HOLD','COMPLETED','CANCELLED'))`);
    await q.query(`ALTER TABLE "project" ADD CONSTRAINT "ck_project_billing" CHECK ("billing_type" IN ('FIXED','TIME_MATERIALS','NON_BILLABLE'))`);
    await q.query(`CREATE INDEX "ix_project_status" ON "project" ("tenant_id","status")`);
    await q.query(`ALTER TABLE "project" ADD CONSTRAINT "fk_project_client"
      FOREIGN KEY ("tenant_id","client_id") REFERENCES "crm_client"("tenant_id","id") ON DELETE SET NULL`);
    await fkEmployee('project', 'manager_employee_id', 'project_manager');

    // ── Members ─────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('project_member', [
        '"project_id" uuid NOT NULL',
        '"employee_id" uuid NOT NULL',
        '"role" text',
        '"cost_rate_minor" bigint NOT NULL DEFAULT 0',
        '"bill_rate_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('project_member');
    await q.query(`CREATE UNIQUE INDEX "uq_project_member" ON "project_member" ("tenant_id","project_id","employee_id") WHERE "deleted_at" IS NULL`);
    await fkProject('project_member', 'project_member_project');
    await fkEmployee('project_member', 'employee_id', 'project_member_employee');

    // ── Tasks ───────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('project_task', [
        '"project_id" uuid NOT NULL',
        '"name" text NOT NULL',
        '"assignee_employee_id" uuid',
        `"status" text NOT NULL DEFAULT 'TODO'`,
        `"priority" text NOT NULL DEFAULT 'NORMAL'`,
        '"estimate_minutes" integer NOT NULL DEFAULT 0',
        '"due_date" date',
        '"sort" integer NOT NULL DEFAULT 0',
        '"description" text',
      ]),
    );
    await uq('project_task');
    await q.query(`ALTER TABLE "project_task" ADD CONSTRAINT "ck_ptask_status" CHECK ("status" IN ('TODO','IN_PROGRESS','BLOCKED','DONE'))`);
    await q.query(`ALTER TABLE "project_task" ADD CONSTRAINT "ck_ptask_priority" CHECK ("priority" IN ('LOW','NORMAL','HIGH','URGENT'))`);
    await q.query(`CREATE INDEX "ix_ptask_project" ON "project_task" ("tenant_id","project_id","status")`);
    await fkProject('project_task', 'ptask_project');
    await fkEmployee('project_task', 'assignee_employee_id', 'ptask_assignee');

    // ── Time entries ────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('project_time_entry', [
        '"project_id" uuid NOT NULL',
        '"task_id" uuid',
        '"employee_id" uuid NOT NULL',
        '"entry_date" date NOT NULL DEFAULT current_date',
        '"minutes" integer NOT NULL DEFAULT 0',
        '"billable" boolean NOT NULL DEFAULT true',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"cost_minor" bigint NOT NULL DEFAULT 0',
        '"bill_minor" bigint NOT NULL DEFAULT 0',
        '"description" text',
      ]),
    );
    await uq('project_time_entry');
    await q.query(`ALTER TABLE "project_time_entry" ADD CONSTRAINT "ck_ptime_status" CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED'))`);
    await q.query(`ALTER TABLE "project_time_entry" ADD CONSTRAINT "ck_ptime_minutes" CHECK ("minutes" > 0)`);
    await q.query(`CREATE INDEX "ix_ptime_project" ON "project_time_entry" ("tenant_id","project_id")`);
    await q.query(`CREATE INDEX "ix_ptime_employee" ON "project_time_entry" ("tenant_id","employee_id","entry_date")`);
    await fkProject('project_time_entry', 'ptime_project');
    await q.query(`ALTER TABLE "project_time_entry" ADD CONSTRAINT "fk_ptime_task"
      FOREIGN KEY ("tenant_id","task_id") REFERENCES "project_task"("tenant_id","id") ON DELETE SET NULL`);
    await fkEmployee('project_time_entry', 'employee_id', 'ptime_employee');

    // ── Expenses ────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('project_expense', [
        '"project_id" uuid NOT NULL',
        '"expense_date" date NOT NULL DEFAULT current_date',
        '"category" text',
        '"amount_minor" bigint NOT NULL DEFAULT 0',
        '"billable" boolean NOT NULL DEFAULT true',
        '"employee_id" uuid',
        '"description" text',
      ]),
    );
    await uq('project_expense');
    await q.query(`CREATE INDEX "ix_pexpense_project" ON "project_expense" ("tenant_id","project_id")`);
    await fkProject('project_expense', 'pexpense_project');
    await fkEmployee('project_expense', 'employee_id', 'pexpense_employee');

    for (const t of ['project', 'project_member', 'project_task', 'project_time_entry', 'project_expense']) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['project_expense', 'project_time_entry', 'project_task', 'project_member', 'project', 'project_doc_seq']) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
