import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Inventory product categories — a 3-level hierarchy (category → sub-category → sub-sub-category).
 *
 * `inventory_category` is a tenant-scoped (RLS) self-referencing tree. `parent_id` points at the row
 * one level up via a composite (tenant_id, id) FK, so a category cannot parent across tenants. `level`
 * is denormalised (1..3) with a CHECK capping the depth at three; the service guarantees
 * level = parent.level + 1. Sibling names are unique under the same parent (case-insensitive); the
 * synthetic NULL-parent key keeps top-level names unique too.
 *
 * `inventory_product.category_id` links a product to any node in the tree (leaf or branch) via a
 * composite FK with ON DELETE SET NULL, so deleting a category never deletes its products — it just
 * unlinks them. The legacy free-text `inventory_product.category` column is left in place for
 * backward compatibility (older reports read it).
 */
export class InventoryCategories1721600000000 implements MigrationInterface {
  name = 'InventoryCategories1721600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('inventory_category', [
        '"name" text NOT NULL',
        '"code" text',
        '"parent_id" uuid',
        '"level" integer NOT NULL DEFAULT 1',
      ]),
    );
    await q.query(
      `ALTER TABLE "inventory_category" ADD CONSTRAINT "uq_inventory_category_tenant_id" UNIQUE ("tenant_id","id")`,
    );
    await q.query(
      `ALTER TABLE "inventory_category" ADD CONSTRAINT "ck_inventory_category_level" CHECK ("level" BETWEEN 1 AND 3)`,
    );
    // A level-1 category has no parent; deeper levels must have one.
    await q.query(
      `ALTER TABLE "inventory_category" ADD CONSTRAINT "ck_inventory_category_parent"
       CHECK (("level" = 1 AND "parent_id" IS NULL) OR ("level" > 1 AND "parent_id" IS NOT NULL))`,
    );
    // Self-referencing parent FK (tenant-safe via composite key); deleting a parent cascades to its
    // sub-tree — the service blocks deletes that still have children, so this is a safety net only.
    await q.query(
      `ALTER TABLE "inventory_category" ADD CONSTRAINT "fk_inventory_category_parent"
       FOREIGN KEY ("tenant_id","parent_id") REFERENCES "inventory_category"("tenant_id","id") ON DELETE CASCADE`,
    );
    // Sibling names unique (case-insensitive). COALESCE folds the NULL parent of top-level rows to a
    // fixed sentinel so two level-1 categories cannot share a name either.
    await q.query(
      `CREATE UNIQUE INDEX "uq_inventory_category_sibling"
       ON "inventory_category" ("tenant_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"))`,
    );
    await q.query(`CREATE INDEX "ix_inventory_category_parent" ON "inventory_category" ("tenant_id","parent_id")`);

    // Link products to the tree (nullable; SET NULL on category delete so products survive).
    await q.query(`ALTER TABLE "inventory_product" ADD COLUMN IF NOT EXISTS "category_id" uuid`);
    await q.query(
      `ALTER TABLE "inventory_product" ADD CONSTRAINT "fk_inventory_product_category"
       FOREIGN KEY ("tenant_id","category_id") REFERENCES "inventory_category"("tenant_id","id") ON DELETE SET NULL`,
    );
    await q.query(`CREATE INDEX "ix_inventory_product_category" ON "inventory_product" ("tenant_id","category_id")`);

    for (const stmt of enableTenantRlsSql('inventory_category')) await q.query(stmt);
    await q.query(grantAppUserSql('inventory_category'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "inventory_product" DROP CONSTRAINT IF EXISTS "fk_inventory_product_category"`);
    await q.query(`DROP INDEX IF EXISTS "ix_inventory_product_category"`);
    await q.query(`ALTER TABLE "inventory_product" DROP COLUMN IF EXISTS "category_id"`);
    await q.query(`DROP TABLE IF EXISTS "inventory_category" CASCADE`);
  }
}
