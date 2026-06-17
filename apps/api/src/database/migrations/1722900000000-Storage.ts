import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Generic, tenant-scoped binary attachment store (`app_attachment`). A small DB-backed object store
 * so features can persist files (employee photos, receipts, …) without standing up MinIO/S3 wiring —
 * the bytes live in `bytea`, isolated by RLS like every other business row. `kind` namespaces the
 * owner (e.g. `hr.employee_photo`); callers keep the returned id as their `*_ref`. A size cap is
 * enforced in the app layer (StorageService), not the schema.
 */
export class Storage1722900000000 implements MigrationInterface {
  name = 'Storage1722900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('app_attachment', [
        '"kind" text NOT NULL',
        '"content_type" text NOT NULL',
        '"file_name" text',
        '"byte_size" integer NOT NULL',
        '"data" bytea NOT NULL',
      ]),
    );
    await q.query(`ALTER TABLE "app_attachment" ADD CONSTRAINT "uq_app_attachment_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX "ix_app_attachment_kind" ON "app_attachment" ("tenant_id","kind")`);
    for (const stmt of enableTenantRlsSql('app_attachment')) await q.query(stmt);
    await q.query(grantAppUserSql('app_attachment'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "app_attachment" CASCADE`);
  }
}
