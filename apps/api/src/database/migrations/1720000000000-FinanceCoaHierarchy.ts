import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chart-of-accounts hierarchy (multi-level COA). Adds a self-referential parent + a group flag to
 * `finance_account` so accounts form a tree: GROUP accounts (`is_group=true`) are headers you nest
 * under and never post to; leaf accounts are postable. The FK is composite `(tenant_id, parent_id)`
 * -> `(tenant_id, id)` (the table already has the `UNIQUE (tenant_id, id)` target), so a parent can
 * never live in another tenant. Fully idempotent: every step guards with IF [NOT] EXISTS / a catalog
 * check, so a second run is a no-op (ADR-003). No RLS change — the new columns inherit the table's
 * existing tenant-isolation policy.
 */
export class FinanceCoaHierarchy1720000000000 implements MigrationInterface {
  name = 'FinanceCoaHierarchy1720000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "finance_account" ADD COLUMN IF NOT EXISTS "parent_id" uuid`);
    await q.query(`ALTER TABLE "finance_account" ADD COLUMN IF NOT EXISTS "is_group" boolean NOT NULL DEFAULT false`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_finance_account_parent" ON "finance_account" ("tenant_id","parent_id")`);
    // ADD CONSTRAINT has no IF NOT EXISTS — guard on the catalog so re-runs are no-ops.
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_finance_account_parent') THEN
          ALTER TABLE "finance_account" ADD CONSTRAINT "fk_finance_account_parent"
            FOREIGN KEY ("tenant_id","parent_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE RESTRICT;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "finance_account" DROP CONSTRAINT IF EXISTS "fk_finance_account_parent"`);
    await q.query(`DROP INDEX IF EXISTS "ix_finance_account_parent"`);
    await q.query(`ALTER TABLE "finance_account" DROP COLUMN IF EXISTS "is_group"`);
    await q.query(`ALTER TABLE "finance_account" DROP COLUMN IF EXISTS "parent_id"`);
  }
}
