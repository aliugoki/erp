import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch-awareness for Inventory + POS: `inventory_warehouse.branch_id` and `pos_register.branch_id`
 * (nullable, composite FK → branch(tenant_id,id) ON DELETE SET NULL, indexed) so stock locations and
 * sales tills belong to a company branch. Idempotent.
 */
export class WarehousePosBranchLink1727420000000 implements MigrationInterface {
  name = 'WarehousePosBranchLink1727420000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of ['inventory_warehouse', 'pos_register']) {
      await q.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "branch_id" uuid`);
      await q.query(`CREATE INDEX IF NOT EXISTS "ix_${table}_branch" ON "${table}" ("tenant_id","branch_id")`);
      await q.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_${table}_branch') THEN
            ALTER TABLE "${table}" ADD CONSTRAINT "fk_${table}_branch"
              FOREIGN KEY ("tenant_id","branch_id") REFERENCES "branch"("tenant_id","id") ON DELETE SET NULL;
          END IF;
        END $$;
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['inventory_warehouse', 'pos_register']) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "fk_${table}_branch"`);
      await q.query(`DROP INDEX IF EXISTS "ix_${table}_branch"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "branch_id"`);
    }
  }
}
