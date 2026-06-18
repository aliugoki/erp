import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Product reviews. A signed-in customer leaves a 1–5 star rating (one per product); reviews start
 * PENDING and only show on the storefront once an admin APPROVES them. `verified` marks a reviewer who
 * actually ordered the product (matched by their email). Tenant-scoped (RLS).
 */
export class EcommerceReviews1724700000000 implements MigrationInterface {
  name = 'EcommerceReviews1724700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('ec_review', [
        '"product_id" uuid NOT NULL',
        '"customer_id" uuid',
        '"author_name" text NOT NULL',
        '"rating" integer NOT NULL',
        '"title" text',
        '"body" text',
        `"status" text NOT NULL DEFAULT 'PENDING'`,
        '"verified" boolean NOT NULL DEFAULT false',
      ]),
    );
    await q.query(`ALTER TABLE "ec_review" ADD CONSTRAINT "uq_ec_review_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`ALTER TABLE "ec_review" ADD CONSTRAINT "ck_ec_review_rating" CHECK ("rating" BETWEEN 1 AND 5)`);
    await q.query(`ALTER TABLE "ec_review" ADD CONSTRAINT "ck_ec_review_status" CHECK ("status" IN ('PENDING','APPROVED','REJECTED'))`);
    await q.query(`ALTER TABLE "ec_review" ADD CONSTRAINT "fk_ec_review_product"
      FOREIGN KEY ("tenant_id","product_id") REFERENCES "ec_product"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_review_customer" ON "ec_review" ("tenant_id","product_id","customer_id") WHERE customer_id IS NOT NULL AND deleted_at IS NULL`);
    await q.query(`CREATE INDEX "ix_ec_review_product" ON "ec_review" ("tenant_id","product_id","status")`);
    for (const stmt of enableTenantRlsSql('ec_review')) await q.query(stmt);
    await q.query(grantAppUserSql('ec_review'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ec_review" CASCADE`);
  }
}
