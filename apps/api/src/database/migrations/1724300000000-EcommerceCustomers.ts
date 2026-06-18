import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Storefront customer accounts. Shoppers are NOT ERP `users` (staff with RBAC roles) — they are
 * per-tenant `ec_customer` rows with their own email + password, authenticated by a distinct
 * `typ: 'customer'` token. Order history is matched by the customer's email, so no change to orders is
 * needed. Tenant-scoped (RLS); email is unique per tenant.
 */
export class EcommerceCustomers1724300000000 implements MigrationInterface {
  name = 'EcommerceCustomers1724300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('ec_customer', [
        '"email" text NOT NULL',
        '"password_hash" text NOT NULL',
        '"name" text NOT NULL',
        '"phone" text',
      ]),
    );
    await q.query(`ALTER TABLE "ec_customer" ADD CONSTRAINT "uq_ec_customer_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_customer_email" ON "ec_customer" ("tenant_id", lower("email")) WHERE deleted_at IS NULL`);
    for (const stmt of enableTenantRlsSql('ec_customer')) await q.query(stmt);
    await q.query(grantAppUserSql('ec_customer'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ec_customer" CASCADE`);
  }
}
