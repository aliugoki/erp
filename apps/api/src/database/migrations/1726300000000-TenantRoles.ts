import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, disableTenantRlsSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Custom (composite) roles — per-tenant RBAC managed by a company's own TENANT_ADMIN. A custom role
 * is a named bundle of the platform's built-in capability roles (HR/Finance/Inventory/Sales/Support/
 * Viewer); `member_roles` lists those built-ins. At login a user's assigned roles are expanded to the
 * union of built-ins, so the existing role-guarded endpoints enforce custom roles with no change.
 * Tenant-scoped + RLS like every business table.
 */
export class TenantRoles1726300000000 implements MigrationInterface {
  name = 'TenantRoles1726300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('tenant_role', [
        '"key" text NOT NULL',
        '"name" text NOT NULL',
        '"description" text',
        `"member_roles" text[] NOT NULL DEFAULT '{}'`,
      ]),
    );
    await q.query(`ALTER TABLE "tenant_role" ADD CONSTRAINT "uq_tenant_role_tenant_id" UNIQUE ("tenant_id","id")`);
    // A role key is unique within a tenant among live rows (soft-deleted keys may be reused).
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_role_key" ON "tenant_role" ("tenant_id","key") WHERE "deleted_at" IS NULL`,
    );
    for (const stmt of enableTenantRlsSql('tenant_role')) await q.query(stmt);
    await q.query(grantAppUserSql('tenant_role'));
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const stmt of disableTenantRlsSql('tenant_role')) await q.query(stmt);
    await q.query(`DROP INDEX IF EXISTS "uq_tenant_role_key"`);
    await q.query(`DROP TABLE IF EXISTS "tenant_role"`);
  }
}
