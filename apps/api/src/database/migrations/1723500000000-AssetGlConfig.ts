import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Maps the two GL accounts a depreciation run posts to: Dr depreciation expense, Cr accumulated
 * depreciation. One row per tenant (UNIQUE on tenant_id). When set, the AssetGlConsumer posts a
 * journal voucher from each `asset.depreciation_posted` event; when unset, GL posting is skipped (the
 * depreciation entries in the asset ledger are unaffected). Both accounts are leaf finance accounts.
 */
export class AssetGlConfig1723500000000 implements MigrationInterface {
  name = 'AssetGlConfig1723500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('asset_gl_config', [
        '"depreciation_expense_account_id" uuid',
        '"accumulated_depreciation_account_id" uuid',
      ]),
    );
    await q.query(`ALTER TABLE "asset_gl_config" ADD CONSTRAINT "uq_asset_gl_config_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_asset_gl_config_tenant" ON "asset_gl_config" ("tenant_id")`);
    await q.query(`ALTER TABLE "asset_gl_config" ADD CONSTRAINT "fk_asset_gl_expense"
      FOREIGN KEY ("tenant_id","depreciation_expense_account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "asset_gl_config" ADD CONSTRAINT "fk_asset_gl_accum"
      FOREIGN KEY ("tenant_id","accumulated_depreciation_account_id") REFERENCES "finance_account"("tenant_id","id") ON DELETE SET NULL`);
    for (const stmt of enableTenantRlsSql('asset_gl_config')) await q.query(stmt);
    await q.query(grantAppUserSql('asset_gl_config'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "asset_gl_config" CASCADE`);
  }
}
