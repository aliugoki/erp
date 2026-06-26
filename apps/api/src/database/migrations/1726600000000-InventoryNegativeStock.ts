import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Policy engine (ADR-011): make `inventory.allow_negative_stock` authoritative. The rigid
 * `CHECK (on_hand >= 0)` is replaced by an application gate in the two on-hand decrement paths
 * (`InventoryService.createMovement`, `InventoryDocsService.postLedger`), which block oversell unless
 * the tenant has enabled negative stock. Default policy = false, so behaviour is unchanged. The
 * pharmacy lot check (`ck_pharmacy_lot_qty`) is a separate invariant and is left intact.
 */
export class InventoryNegativeStock1726600000000 implements MigrationInterface {
  name = 'InventoryNegativeStock1726600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "inventory_product" DROP CONSTRAINT IF EXISTS "ck_inventory_product_onhand"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Best-effort restore (fails if any tenant currently holds negative stock).
    await q.query(
      `ALTER TABLE "inventory_product" ADD CONSTRAINT "ck_inventory_product_onhand" CHECK ("on_hand" >= 0)`,
    );
  }
}
