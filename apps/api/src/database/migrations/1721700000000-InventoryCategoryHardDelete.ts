import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Category deletes are now physical (see InventoryCategoriesService.removeCategory). Earlier deletes
 * ran under the old soft-delete behaviour and left rows behind with `deleted_at` set — invisible in
 * the app (every query filters `deleted_at IS NULL`) but still occupying the unique sibling-name slot,
 * so a deleted name could not be reused. Purge those tombstoned rows so the table reflects reality
 * and the names free up. Going forward no category row is ever soft-deleted, so this stays a no-op on
 * re-run (idempotent).
 *
 * Irreversible by nature (the rows were already deleted), so `down` is a no-op.
 */
export class InventoryCategoryHardDelete1721700000000 implements MigrationInterface {
  name = 'InventoryCategoryHardDelete1721700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "inventory_category" WHERE "deleted_at" IS NOT NULL`);
  }

  public async down(): Promise<void> {
    // No-op: the purged rows were already soft-deleted; there is nothing to restore.
  }
}
