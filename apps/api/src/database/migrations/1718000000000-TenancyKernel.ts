import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PROBE_TABLE,
  createTenantTableSql,
  disableTenantRlsSql,
  enableTenantRlsSql,
  grantAppUserSql,
} from '../sql/tenancy.sql';

/**
 * Tenancy kernel migration. Establishes the RLS pattern on a canary table (`tenant_probe`) so the
 * mechanism is proven before any business module exists. Future module migrations reuse the same
 * `createTenantTableSql` / `enableTenantRlsSql` helpers. Runs as the owner (direct, bypassing
 * PgBouncer); the app connects as `app_user` and is therefore subject to these policies.
 */
export class TenancyKernel1718000000000 implements MigrationInterface {
  name = 'TenancyKernel1718000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(createTenantTableSql(PROBE_TABLE, ['"name" varchar NOT NULL']));
    for (const stmt of enableTenantRlsSql(PROBE_TABLE)) {
      await queryRunner.query(stmt);
    }
    await queryRunner.query(grantAppUserSql(PROBE_TABLE));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const stmt of disableTenantRlsSql(PROBE_TABLE)) {
      await queryRunner.query(stmt);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`);
  }
}
