import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Order-to-cash saga (Chunk 7.3). `sales_order` is the saga state aggregate (status walks
 * PENDING → RESERVED → INVOICED → PAID, or → COMPENSATED on a failed step). `inventory_reservation`
 * is the stock hold a successful saga consumes and a failed saga releases. Both tenant-scoped (RLS).
 * Steps run in separate transactions, so a later failure requires explicit compensation of the
 * already-committed earlier steps (release reservation, void invoice) — a real saga, not a single
 * rollback.
 */
export class OrderToCashSaga1719800000000 implements MigrationInterface {
  name = 'OrderToCashSaga1719800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('inventory_reservation', [
        '"order_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"quantity" integer NOT NULL',
        `"status" text NOT NULL DEFAULT 'HELD'`,
      ]),
    );
    await q.query(
      `ALTER TABLE "inventory_reservation" ADD CONSTRAINT "ck_inventory_reservation_status" CHECK ("status" IN ('HELD','RELEASED','CONSUMED'))`,
    );
    await q.query(`CREATE INDEX "ix_inventory_reservation_order" ON "inventory_reservation" ("tenant_id","order_id")`);

    await q.query(
      createTenantTableSql('sales_order', [
        '"product_id" uuid NOT NULL',
        '"quantity" integer NOT NULL',
        '"unit_price_minor" bigint NOT NULL',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        `"status" text NOT NULL DEFAULT 'PENDING'`,
        '"reservation_id" uuid',
        '"invoice_id" uuid',
        '"failure_step" text',
        '"failure_reason" text',
      ]),
    );
    await q.query(
      `ALTER TABLE "sales_order" ADD CONSTRAINT "ck_sales_order_status" CHECK ("status" IN ('PENDING','RESERVED','INVOICED','PAID','COMPENSATED','FAILED'))`,
    );

    for (const table of ['inventory_reservation', 'sales_order']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['sales_order', 'inventory_reservation']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
