import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Product images. A product can have several images (each stored as an `app_attachment` — the reusable
 * tenant-scoped binary store) linked via `inventory_product_image`, with a sort order and a single
 * primary used as the thumbnail. Tenant-scoped (RLS); composite FKs cascade on product/attachment delete.
 */
export class ProductImages1723900000000 implements MigrationInterface {
  name = 'ProductImages1723900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('inventory_product_image', [
        '"product_id" uuid NOT NULL',
        '"attachment_id" uuid NOT NULL',
        '"sort" integer NOT NULL DEFAULT 0',
        '"is_primary" boolean NOT NULL DEFAULT false',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_product_image" ADD CONSTRAINT "uq_inventory_product_image_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX "ix_product_image_product" ON "inventory_product_image" ("tenant_id","product_id")`);
    // At most one primary image per product.
    await q.query(`CREATE UNIQUE INDEX "ux_product_image_primary" ON "inventory_product_image" ("tenant_id","product_id")
      WHERE "is_primary" = true AND "deleted_at" IS NULL`);
    await q.query(`ALTER TABLE "inventory_product_image" ADD CONSTRAINT "fk_product_image_product"
      FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "inventory_product_image" ADD CONSTRAINT "fk_product_image_attachment"
      FOREIGN KEY ("tenant_id","attachment_id") REFERENCES "app_attachment"("tenant_id","id") ON DELETE CASCADE`);
    for (const stmt of enableTenantRlsSql('inventory_product_image')) await q.query(stmt);
    await q.query(grantAppUserSql('inventory_product_image'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "inventory_product_image" CASCADE`);
  }
}
