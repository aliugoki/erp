import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Maps the GL accounts a completed production order posts to. One row per tenant. When configured, the
 * ProductionGlConsumer turns each `production.order_completed` event into a journal voucher:
 *   Dr finished-goods inventory (total cost)
 *   Cr raw-materials inventory (material), Cr labour applied (operation), Cr overhead applied (overhead)
 * Zero components are omitted; the voucher stays balanced (total = material + operation + overhead).
 */
export class ProductionGlConfig1723700000000 implements MigrationInterface {
  name = 'ProductionGlConfig1723700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('production_gl_config', [
        '"fg_inventory_account_id" uuid',
        '"raw_materials_account_id" uuid',
        '"labor_account_id" uuid',
        '"overhead_account_id" uuid',
      ]),
    );
    await q.query(`ALTER TABLE "production_gl_config" ADD CONSTRAINT "uq_production_gl_config_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_production_gl_config_tenant" ON "production_gl_config" ("tenant_id")`);
    for (const col of ['fg_inventory', 'raw_materials', 'labor', 'overhead']) {
      await q.query(`ALTER TABLE "production_gl_config" ADD CONSTRAINT "fk_prod_gl_${col}"
        FOREIGN KEY ("tenant_id","${col}_account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE SET NULL`);
    }
    for (const stmt of enableTenantRlsSql('production_gl_config')) await q.query(stmt);
    await q.query(grantAppUserSql('production_gl_config'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "production_gl_config" CASCADE`);
  }
}
