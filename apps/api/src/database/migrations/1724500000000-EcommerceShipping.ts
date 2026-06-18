import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Shipping zones for the online store. Each zone covers a set of countries with its own flat rate and
 * optional free-shipping threshold; a zone with no countries is a catch-all ("rest of world"). At
 * checkout the destination country selects the zone (specific match first, then catch-all, else the
 * store's default rate). Tenant-scoped (RLS).
 */
export class EcommerceShipping1724500000000 implements MigrationInterface {
  name = 'EcommerceShipping1724500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('ec_shipping_zone', [
        '"name" text NOT NULL',
        `"countries" text[] NOT NULL DEFAULT '{}'`,
        '"rate_minor" bigint NOT NULL DEFAULT 0',
        '"free_over_minor" bigint',
        '"sort" integer NOT NULL DEFAULT 0',
        '"enabled" boolean NOT NULL DEFAULT true',
      ]),
    );
    await q.query(`ALTER TABLE "ec_shipping_zone" ADD CONSTRAINT "uq_ec_shipping_zone_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX "ix_ec_shipping_zone" ON "ec_shipping_zone" ("tenant_id","enabled")`);
    for (const stmt of enableTenantRlsSql('ec_shipping_zone')) await q.query(stmt);
    await q.query(grantAppUserSql('ec_shipping_zone'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ec_shipping_zone" CASCADE`);
  }
}
