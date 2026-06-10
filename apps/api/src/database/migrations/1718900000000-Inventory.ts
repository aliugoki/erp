import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Inventory module schema (Chunk 3.3). Tenant-scoped (RLS), money as bigint minor units, composite
 * (tenant_id, id) FKs. `inventory_product.on_hand` carries the running quantity with a
 * `CHECK (on_hand >= 0)` — an OUT that would oversell fails the update, rolling back the whole
 * movement transaction (including any low-stock outbox row written in it).
 */
export class Inventory1718900000000 implements MigrationInterface {
  name = 'Inventory1718900000000';

  public async up(q: QueryRunner): Promise<void> {
    // Warehouses
    await q.query(
      createTenantTableSql('inventory_warehouse', [
        '"name" text NOT NULL',
        '"code" text',
        '"location" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_warehouse" ADD CONSTRAINT "uq_inventory_warehouse_tenant_id" UNIQUE ("tenant_id","id")`);

    // Products
    await q.query(
      createTenantTableSql('inventory_product', [
        '"sku" text NOT NULL',
        '"name" text NOT NULL',
        '"category" text',
        `"unit" text NOT NULL DEFAULT 'unit'`,
        '"cost_price_minor" bigint NOT NULL DEFAULT 0',
        '"sell_price_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"min_stock" integer NOT NULL DEFAULT 0',
        '"on_hand" integer NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_product" ADD CONSTRAINT "uq_inventory_product_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_inventory_product_sku" ON "inventory_product" ("tenant_id", lower("sku"))`);
    await q.query(`ALTER TABLE "inventory_product" ADD CONSTRAINT "ck_inventory_product_onhand" CHECK ("on_hand" >= 0)`);
    await q.query(`ALTER TABLE "inventory_product" ADD CONSTRAINT "ck_inventory_product_minstock" CHECK ("min_stock" >= 0)`);
    // Index to find low-stock products quickly.
    await q.query(`CREATE INDEX "ix_inventory_product_lowstock" ON "inventory_product" ("tenant_id") WHERE "on_hand" < "min_stock"`);

    // Stock movements
    await q.query(
      createTenantTableSql('inventory_stock_movement', [
        '"product_id" uuid NOT NULL',
        '"warehouse_id" uuid',
        '"to_warehouse_id" uuid',
        `"type" text NOT NULL`,
        '"quantity" integer NOT NULL',
        '"reference" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_stock_movement" ADD CONSTRAINT "uq_inventory_movement_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`ALTER TABLE "inventory_stock_movement" ADD CONSTRAINT "ck_inventory_movement_type" CHECK ("type" IN ('IN','OUT','TRANSFER'))`);
    await q.query(`ALTER TABLE "inventory_stock_movement" ADD CONSTRAINT "ck_inventory_movement_qty" CHECK ("quantity" > 0)`);
    await q.query(`CREATE INDEX "ix_inventory_movement_product" ON "inventory_stock_movement" ("tenant_id","product_id")`);
    await q.query(
      `ALTER TABLE "inventory_stock_movement" ADD CONSTRAINT "fk_inventory_movement_product"
       FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "inventory_stock_movement" ADD CONSTRAINT "fk_inventory_movement_warehouse"
       FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "inventory_warehouse"("tenant_id","id") ON DELETE SET NULL`,
    );

    for (const table of ['inventory_warehouse', 'inventory_product', 'inventory_stock_movement']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['inventory_stock_movement', 'inventory_product', 'inventory_warehouse']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
