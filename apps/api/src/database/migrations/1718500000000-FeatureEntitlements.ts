import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Per-tenant feature entitlements (ADR-009). Tenant-scoped (RLS). One row per (tenant, feature_key)
 * with an enabled flag and optional config. The unique constraint enables UPSERT on toggle.
 */
export class FeatureEntitlements1718500000000 implements MigrationInterface {
  name = 'FeatureEntitlements1718500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_feature_entitlement" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "feature_key" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "config" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_feature" ON "tenant_feature_entitlement" ("tenant_id", "feature_key")`,
    );
    for (const stmt of enableTenantRlsSql('tenant_feature_entitlement')) await queryRunner.query(stmt);
    await queryRunner.query(grantAppUserSql('tenant_feature_entitlement'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_feature_entitlement"`);
  }
}
