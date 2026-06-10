import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Tamper-evident audit trail (Chunk 2.4). Tenant-scoped (RLS) and append-only in practice. Records
 * who did what to which resource, with before/after JSONB, ip, and the trace id.
 */
export class AuditLog1718400000000 implements MigrationInterface {
  name = 'AuditLog1718400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid,
        "action" text NOT NULL,
        "resource" text NOT NULL,
        "resource_id" text,
        "old_value" jsonb,
        "new_value" jsonb,
        "ip_address" text,
        "trace_id" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "ix_audit_log_tenant_created" ON "audit_log" ("tenant_id", "created_at" DESC)`,
    );
    for (const stmt of enableTenantRlsSql('audit_log')) await queryRunner.query(stmt);
    await queryRunner.query(grantAppUserSql('audit_log'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log"`);
  }
}
