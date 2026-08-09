import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A scannable barcode on the shared product catalogue.
 *
 * Until now `inventory_product` was keyed only by SKU, so scanning a carton in the kitchen store (or
 * at a goods-receipt desk) had to match the SKU field — which works only when someone typed the EAN
 * in as the SKU. A first-class `barcode` column separates the two concerns properly: the SKU is the
 * business's own identifier and keys the valued ledger, while the barcode is whatever is physically
 * printed on the packaging (or minted internally for own-produced goods).
 *
 * Unique per tenant, case-insensitively, among live rows: two products answering to the same scan
 * would make a receiving desk ambiguous.
 */
export class InventoryBarcode1727730000000 implements MigrationInterface {
  name = 'InventoryBarcode1727730000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "inventory_product" ADD COLUMN IF NOT EXISTS "barcode" text`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_product_barcode"
      ON "inventory_product" ("tenant_id", lower("barcode"))
      WHERE "barcode" IS NOT NULL AND "deleted_at" IS NULL`);
    // Scanning is a lookup by barcode; the unique index above already serves it, but receiving flows
    // also search by SKU prefix, so keep that path indexed too.
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_inventory_product_sku_lower"
      ON "inventory_product" ("tenant_id", lower("sku"))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_inventory_product_sku_lower"`);
    await q.query(`DROP INDEX IF EXISTS "uq_inventory_product_barcode"`);
    await q.query(`ALTER TABLE "inventory_product" DROP COLUMN IF EXISTS "barcode"`);
  }
}
