import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Multi-currency master data: the currencies a tenant transacts in (one flagged base) and a
 * time-series of exchange rates to base. Rates are stored as integer micro-units (rate × 1e6) so no
 * floats are persisted; conversion rounds to the nearest minor unit.
 */
export class Currencies1720800000000 implements MigrationInterface {
  name = 'Currencies1720800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('currency', [
        '"code" text NOT NULL',
        '"name" text NOT NULL',
        `"symbol" text`,
        '"is_base" boolean NOT NULL DEFAULT false',
        '"active" boolean NOT NULL DEFAULT true',
      ]),
    );
    await q.query(`CREATE UNIQUE INDEX "uq_currency_code" ON "currency" ("tenant_id", lower("code"))`);
    // At most one base currency per tenant.
    await q.query(`CREATE UNIQUE INDEX "uq_currency_one_base" ON "currency" ("tenant_id") WHERE "is_base" = true`);

    await q.query(
      createTenantTableSql('exchange_rate', [
        '"currency_code" text NOT NULL',
        '"rate_micro" bigint NOT NULL',
        '"as_of" date NOT NULL DEFAULT current_date',
      ]),
    );
    await q.query(`ALTER TABLE "exchange_rate" ADD CONSTRAINT "ck_exchange_rate_pos" CHECK ("rate_micro" > 0)`);
    await q.query(`CREATE INDEX "ix_exchange_rate_lookup" ON "exchange_rate" ("tenant_id","currency_code","as_of")`);

    for (const table of ['currency', 'exchange_rate']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['exchange_rate', 'currency']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
