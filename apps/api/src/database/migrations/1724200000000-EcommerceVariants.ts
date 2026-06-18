import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Product variants for the online store. A listing (`ec_product`) can offer several purchasable
 * variants (e.g. "Red / Large"), each mapped to its OWN `inventory_product` so stock + COGS stay real
 * and per-SKU. Cart items and order lines gain an optional variant reference; a product with no
 * variants behaves exactly as before (the listing's base product is the purchasable unit).
 */
export class EcommerceVariants1724200000000 implements MigrationInterface {
  name = 'EcommerceVariants1724200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('ec_product_variant', [
        '"product_id" uuid NOT NULL',
        '"inventory_product_id" uuid NOT NULL',
        '"label" text NOT NULL',
        '"price_minor" bigint',
        '"compare_at_minor" bigint',
        '"sort" integer NOT NULL DEFAULT 0',
        '"is_default" boolean NOT NULL DEFAULT false',
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
      ]),
    );
    await q.query(`ALTER TABLE "ec_product_variant" ADD CONSTRAINT "uq_ec_product_variant_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`ALTER TABLE "ec_product_variant" ADD CONSTRAINT "fk_ec_variant_product"
      FOREIGN KEY ("tenant_id","product_id") REFERENCES "ec_product"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "ec_product_variant" ADD CONSTRAINT "ck_ec_variant_status" CHECK ("status" IN ('ACTIVE','ARCHIVED'))`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_variant_inv" ON "ec_product_variant" ("tenant_id","product_id","inventory_product_id") WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX "ix_ec_variant_product" ON "ec_product_variant" ("tenant_id","product_id")`);
    for (const stmt of enableTenantRlsSql('ec_product_variant')) await q.query(stmt);
    await q.query(grantAppUserSql('ec_product_variant'));

    // Cart items + order lines reference an optional variant. Replace the cart-item uniqueness so the
    // same product can sit in a cart once per variant (null variant treated as a sentinel).
    await q.query(`ALTER TABLE "ec_cart_item" ADD COLUMN IF NOT EXISTS "variant_id" uuid`);
    await q.query(`DROP INDEX IF EXISTS "uq_ec_cart_item"`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_cart_item" ON "ec_cart_item"
      ("tenant_id","cart_id","product_id", COALESCE("variant_id", '00000000-0000-0000-0000-000000000000'::uuid))`);

    await q.query(`ALTER TABLE "ec_order_line" ADD COLUMN IF NOT EXISTS "variant_id" uuid`);
    await q.query(`ALTER TABLE "ec_order_line" ADD COLUMN IF NOT EXISTS "variant_label" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ec_order_line" DROP COLUMN IF EXISTS "variant_label"`);
    await q.query(`ALTER TABLE "ec_order_line" DROP COLUMN IF EXISTS "variant_id"`);
    await q.query(`DROP INDEX IF EXISTS "uq_ec_cart_item"`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_cart_item" ON "ec_cart_item" ("tenant_id","cart_id","product_id")`);
    await q.query(`ALTER TABLE "ec_cart_item" DROP COLUMN IF EXISTS "variant_id"`);
    await q.query(`DROP TABLE IF EXISTS "ec_product_variant" CASCADE`);
  }
}
