import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, disableTenantRlsSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Company-level **branches** (physical sites / offices). A first-class, tenant-scoped (RLS) entity that
 * HR, Inventory, POS and Finance all reference — the same shared-dimension pattern as `warehouse` and
 * `cost_center`. A branch may name a manager (an employee) and map to a `cost_center` so branch P&L
 * falls out of the existing journal `cost_center_id` plumbing — both nullable, so a company without HR
 * or Finance can still manage branches. Idempotent.
 */
export class Branches1727400000000 implements MigrationInterface {
  name = 'Branches1727400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('branch', [
        '"name" text NOT NULL',
        '"code" text',
        '"address" text',
        '"city" text',
        '"phone" text',
        '"manager_id" uuid',
        '"cost_center_id" uuid',
        '"is_head_office" boolean NOT NULL DEFAULT false',
        '"active" boolean NOT NULL DEFAULT true',
      ]),
    );
    await q.query(`ALTER TABLE "branch" ADD CONSTRAINT "uq_branch_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_branch_code" ON "branch" ("tenant_id", lower("code")) WHERE "code" IS NOT NULL`);
    // Manager → an employee; cost_center → finance dimension. Both nullable, composite (tenant-local).
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_branch_manager') THEN
          ALTER TABLE "branch" ADD CONSTRAINT "fk_branch_manager"
            FOREIGN KEY ("tenant_id","manager_id") REFERENCES "hr_employee"("tenant_id","id") ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_branch_cost_center') THEN
          ALTER TABLE "branch" ADD CONSTRAINT "fk_branch_cost_center"
            FOREIGN KEY ("tenant_id","cost_center_id") REFERENCES "cost_center"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    for (const stmt of enableTenantRlsSql('branch')) await q.query(stmt);
    await q.query(grantAppUserSql('branch'));

    // Back-references: employees and departments map to a branch (independent of each other). Columns
    // added here (schema); the HR service/UI wiring lands in the next chunk. Composite FK + index.
    for (const table of ['hr_employee', 'hr_department']) {
      await q.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "branch_id" uuid`);
      await q.query(`CREATE INDEX IF NOT EXISTS "ix_${table}_branch" ON "${table}" ("tenant_id","branch_id")`);
      await q.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_${table}_branch') THEN
            ALTER TABLE "${table}" ADD CONSTRAINT "fk_${table}_branch"
              FOREIGN KEY ("tenant_id","branch_id") REFERENCES "branch"("tenant_id","id") ON DELETE SET NULL;
          END IF;
        END $$;
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['hr_employee', 'hr_department']) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "fk_${table}_branch"`);
      await q.query(`DROP INDEX IF EXISTS "ix_${table}_branch"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "branch_id"`);
    }
    for (const stmt of disableTenantRlsSql('branch')) await q.query(stmt);
    await q.query(`DROP TABLE IF EXISTS "branch" CASCADE`);
  }
}
