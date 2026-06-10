import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Effect tables for the event reactions (Chunk 4.4). Worker handlers write here in response to
 * domain events (low_stock → PO suggestion, invoice_paid → balance, deal_closed → commission). All
 * tenant-scoped (RLS); idempotency is guaranteed by the consumer (processed_event), so these tables
 * receive each effect exactly once.
 */
export class Reactions1719200000000 implements MigrationInterface {
  name = 'Reactions1719200000000';

  public async up(q: QueryRunner): Promise<void> {
    // low_stock -> purchase-order suggestion
    await q.query(
      createTenantTableSql('po_suggestion', [
        '"product_id" uuid NOT NULL',
        '"suggested_qty" integer NOT NULL',
        `"status" text NOT NULL DEFAULT 'PENDING'`,
        '"source_event_id" uuid',
      ]),
    );

    // invoice_paid -> running received balance per currency (upserted)
    await q.query(
      createTenantTableSql('finance_balance', [
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"total_received_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`CREATE UNIQUE INDEX "uq_finance_balance" ON "finance_balance" ("tenant_id", "currency")`);

    // deal_closed -> commission
    await q.query(
      createTenantTableSql('commission', [
        '"deal_id" uuid NOT NULL',
        '"amount_minor" bigint NOT NULL',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"rate_bps" integer NOT NULL',
        `"status" text NOT NULL DEFAULT 'PENDING'`,
        '"source_event_id" uuid',
      ]),
    );

    for (const table of ['po_suggestion', 'finance_balance', 'commission']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['po_suggestion', 'finance_balance', 'commission']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
