import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Maps the GL accounts a completed POS sale posts to. One row per tenant. When configured, the
 * PosGlConsumer turns each `pos.sale_completed` event into a journal voucher:
 *   Dr clearing (total)  Cr revenue (total − tax)  Cr tax (tax)   — the sale side
 *   Dr COGS (cogs)       Cr inventory (cogs)                       — the cost side
 * (reversed for a RETURN). Unset accounts skip that side; clearing + revenue are the minimum to post.
 */
export class PosGlConfig1723600000000 implements MigrationInterface {
  name = 'PosGlConfig1723600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('pos_gl_config', [
        '"clearing_account_id" uuid',
        '"revenue_account_id" uuid',
        '"tax_account_id" uuid',
        '"cogs_account_id" uuid',
        '"inventory_account_id" uuid',
      ]),
    );
    await q.query(`ALTER TABLE "pos_gl_config" ADD CONSTRAINT "uq_pos_gl_config_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_pos_gl_config_tenant" ON "pos_gl_config" ("tenant_id")`);
    for (const col of ['clearing', 'revenue', 'tax', 'cogs', 'inventory']) {
      await q.query(`ALTER TABLE "pos_gl_config" ADD CONSTRAINT "fk_pos_gl_${col}"
        FOREIGN KEY ("tenant_id","${col}_account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE SET NULL`);
    }
    for (const stmt of enableTenantRlsSql('pos_gl_config')) await q.query(stmt);
    await q.query(grantAppUserSql('pos_gl_config'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "pos_gl_config" CASCADE`);
  }
}
