import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Per-tenant POS / receipt branding — a store name, contact lines, a footer, and a logo (stored in the
 * reusable `app_attachment` store). One row per tenant; shown on the printed sales receipt. Tenant-scoped
 * (RLS); the logo FK clears to null if the underlying attachment is deleted.
 */
export class PosBranding1724000000000 implements MigrationInterface {
  name = 'PosBranding1724000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('pos_branding', [
        '"store_name" text',
        '"address" text',
        '"phone" text',
        '"receipt_footer" text',
        '"logo_attachment_id" uuid',
      ]),
    );
    await q.query(`ALTER TABLE "pos_branding" ADD CONSTRAINT "uq_pos_branding_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_pos_branding_tenant" ON "pos_branding" ("tenant_id")`);
    await q.query(`ALTER TABLE "pos_branding" ADD CONSTRAINT "fk_pos_branding_logo"
      FOREIGN KEY ("tenant_id","logo_attachment_id") REFERENCES "app_attachment"("tenant_id","id") ON DELETE SET NULL`);
    for (const stmt of enableTenantRlsSql('pos_branding')) await q.query(stmt);
    await q.query(grantAppUserSql('pos_branding'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "pos_branding" CASCADE`);
  }
}
