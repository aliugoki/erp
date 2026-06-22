import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Pharmacy P3 — stock adjustments + procurement tie-in. `pharmacy_stock_adjustment` (+ items) records
 * the three non-sale stock movements that still need valuing + a GL posting: RETURN-to-vendor (RTV),
 * expiry WRITE-OFF, and manual ADJUST (cycle-count correction). Each item moves a specific lot and the
 * shared valued ledger; the header is emitted to the outbox so the GL consumer posts Dr write-off / Cr
 * inventory (write-off), Dr clearing / Cr inventory (RTV), or the inventory↔adjustment pair (adjust).
 * Also links a pharmacy receipt to an inventory purchase order (`po_id`) so batch goods-in updates the
 * PO's received quantities — the batch-aware GRN.
 */
export class PharmacyAdjustments1726100000000 implements MigrationInterface {
  name = 'PharmacyAdjustments1726100000000';

  public async up(q: QueryRunner): Promise<void> {
    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);

    await q.query(`ALTER TABLE "pharmacy_receipt" ADD COLUMN IF NOT EXISTS "po_id" uuid`);

    await q.query(
      createTenantTableSql('pharmacy_stock_adjustment', [
        '"adj_no" text NOT NULL',
        `"type" text NOT NULL DEFAULT 'WRITEOFF'`,
        '"vendor_id" uuid',
        '"reason" text',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"occurred_on" date NOT NULL DEFAULT current_date',
        `"status" text NOT NULL DEFAULT 'POSTED'`,
        '"notes" text',
      ]),
    );
    await uq('pharmacy_stock_adjustment');
    await q.query(`ALTER TABLE "pharmacy_stock_adjustment" ADD CONSTRAINT "ck_pharmacy_adj_type" CHECK ("type" IN ('RTV','WRITEOFF','ADJUST'))`);
    await q.query(`CREATE INDEX "ix_pharmacy_adj_type" ON "pharmacy_stock_adjustment" ("tenant_id","type","occurred_on")`);

    await q.query(
      createTenantTableSql('pharmacy_stock_adjustment_item', [
        '"adjustment_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"lot_id" uuid',
        '"lot_no" text',
        `"direction" text NOT NULL DEFAULT 'OUT'`,
        '"qty" integer NOT NULL',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('pharmacy_stock_adjustment_item');
    await q.query(`ALTER TABLE "pharmacy_stock_adjustment_item" ADD CONSTRAINT "ck_pharmacy_adj_item_dir" CHECK ("direction" IN ('IN','OUT'))`);
    await q.query(`ALTER TABLE "pharmacy_stock_adjustment_item" ADD CONSTRAINT "fk_pharmacy_adj_item_adj"
      FOREIGN KEY ("tenant_id","adjustment_id") REFERENCES "pharmacy_stock_adjustment"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE INDEX "ix_pharmacy_adj_item_product" ON "pharmacy_stock_adjustment_item" ("tenant_id","product_id")`);

    for (const t of ['pharmacy_stock_adjustment', 'pharmacy_stock_adjustment_item']) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['pharmacy_stock_adjustment_item', 'pharmacy_stock_adjustment']) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
    await q.query(`ALTER TABLE "pharmacy_receipt" DROP COLUMN IF EXISTS "po_id"`);
  }
}
