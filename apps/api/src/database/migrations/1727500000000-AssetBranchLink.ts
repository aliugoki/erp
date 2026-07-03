import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch-awareness for fixed assets: `asset.branch_id` (nullable, composite FK → branch(tenant_id,id)
 * ON DELETE SET NULL, indexed) so each asset belongs to a company branch — completing the company-wide
 * branch dimension across HR / Inventory / POS / Finance / Assets. Idempotent.
 */
export class AssetBranchLink1727500000000 implements MigrationInterface {
  name = 'AssetBranchLink1727500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "branch_id" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_asset_branch" ON "asset" ("tenant_id","branch_id")`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_asset_branch') THEN
          ALTER TABLE "asset" ADD CONSTRAINT "fk_asset_branch"
            FOREIGN KEY ("tenant_id","branch_id") REFERENCES "branch"("tenant_id","id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "asset" DROP CONSTRAINT IF EXISTS "fk_asset_branch"`);
    await q.query(`DROP INDEX IF EXISTS "ix_asset_branch"`);
    await q.query(`ALTER TABLE "asset" DROP COLUMN IF EXISTS "branch_id"`);
  }
}
