import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Precomputed demand forecasts (Chunk 6.2). The ML service (apps/ml) fits a model on historical
 * `inventory_stock_movement` OUT demand per (product, warehouse) and writes the result here; the
 * `POST /ml/forecast/demand` endpoint then SERVES this row (fast) instead of fitting per request.
 * Tenant-scoped (RLS). `warehouse_id` uses an all-zeros sentinel for "unspecified / all warehouses",
 * so the unique key works (SQL NULLs are distinct). `forecast` holds {dates,predicted,lower,upper}.
 */
export class MlDemandForecast1719500000000 implements MigrationInterface {
  name = 'MlDemandForecast1719500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('ml_demand_forecast', [
        '"product_id" uuid NOT NULL',
        `"warehouse_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'`,
        '"horizon" integer NOT NULL',
        `"model" text NOT NULL DEFAULT 'naive'`,
        '"history_points" integer NOT NULL DEFAULT 0',
        '"forecast" jsonb NOT NULL',
        '"fitted_at" timestamptz NOT NULL DEFAULT now()',
      ]),
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_ml_demand_forecast" ON "ml_demand_forecast" ("tenant_id", "product_id", "warehouse_id")`,
    );

    for (const stmt of enableTenantRlsSql('ml_demand_forecast')) await q.query(stmt);
    await q.query(grantAppUserSql('ml_demand_forecast'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ml_demand_forecast" CASCADE`);
  }
}
