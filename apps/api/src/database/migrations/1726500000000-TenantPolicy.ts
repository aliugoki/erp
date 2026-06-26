import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, disableTenantRlsSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Per-tenant business-rule / validation policies (policy engine, Phase A). Each row is a tenant's
 * override of a registry-defined policy (`key` = `domain.policy`), value as JSONB. Absent row → the
 * registry default applies. Tenant-scoped + RLS like every business table. Phase A is config-only
 * (no enforcement); modules consult `PolicyService` at decision points from Phase B.
 */
export class TenantPolicy1726500000000 implements MigrationInterface {
  name = 'TenantPolicy1726500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('tenant_policy', ['"key" text NOT NULL', '"value" jsonb NOT NULL']),
    );
    await q.query(`ALTER TABLE "tenant_policy" ADD CONSTRAINT "uq_tenant_policy" UNIQUE ("tenant_id","key")`);
    for (const stmt of enableTenantRlsSql('tenant_policy')) await q.query(stmt);
    await q.query(grantAppUserSql('tenant_policy'));
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const stmt of disableTenantRlsSql('tenant_policy')) await q.query(stmt);
    await q.query(`DROP TABLE IF EXISTS "tenant_policy"`);
  }
}
