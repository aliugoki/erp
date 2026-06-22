import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Pharmacy P4 — hospital + wholesale workflows on top of the shared dispense engine. HOSPITAL: a ward
 * raises a `pharmacy_ward_requisition`, a pharmacist approves it, then issues it (a HOSPITAL_ISSUE
 * dispense charged to the ward/patient). WHOLESALE: a B2B customer order (`pharmacy_sales_order`) is
 * confirmed then fulfilled (a WHOLESALE dispense), with `pharmacy_price_tier` giving quantity-break
 * pricing per drug. Stock + GL still flow through the P2 dispense path (FEFO + journal voucher).
 */
export class PharmacyHospitalWholesale1726200000000 implements MigrationInterface {
  name = 'PharmacyHospitalWholesale1726200000000';

  public async up(q: QueryRunner): Promise<void> {
    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);

    // ── Hospital: ward requisitions ───────────────────────────────────────────────
    await q.query(
      createTenantTableSql('pharmacy_ward_requisition', [
        '"req_no" text NOT NULL',
        '"ward" text NOT NULL',
        '"requested_by" text',
        `"priority" text NOT NULL DEFAULT 'ROUTINE'`,
        '"patient_ref" text',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"needed_by" date',
        '"notes" text',
      ]),
    );
    await uq('pharmacy_ward_requisition');
    await q.query(`ALTER TABLE "pharmacy_ward_requisition" ADD CONSTRAINT "ck_pharmacy_ward_req_priority" CHECK ("priority" IN ('ROUTINE','URGENT','STAT'))`);
    await q.query(`ALTER TABLE "pharmacy_ward_requisition" ADD CONSTRAINT "ck_pharmacy_ward_req_status" CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','ISSUED','CANCELLED'))`);
    await q.query(`CREATE INDEX "ix_pharmacy_ward_req_status" ON "pharmacy_ward_requisition" ("tenant_id","status")`);

    await q.query(
      createTenantTableSql('pharmacy_ward_requisition_item', [
        '"requisition_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"qty" integer NOT NULL',
        '"issued_qty" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('pharmacy_ward_requisition_item');
    await q.query(`ALTER TABLE "pharmacy_ward_requisition_item" ADD CONSTRAINT "fk_pharmacy_ward_req_item_req"
      FOREIGN KEY ("tenant_id","requisition_id") REFERENCES "pharmacy_ward_requisition"("tenant_id","id") ON DELETE CASCADE`);

    // ── Wholesale: B2B sales orders ───────────────────────────────────────────────
    await q.query(
      createTenantTableSql('pharmacy_sales_order', [
        '"order_no" text NOT NULL',
        '"customer_id" uuid',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"expected_on" date',
        '"notes" text',
      ]),
    );
    await uq('pharmacy_sales_order');
    await q.query(`ALTER TABLE "pharmacy_sales_order" ADD CONSTRAINT "ck_pharmacy_so_status" CHECK ("status" IN ('DRAFT','CONFIRMED','PARTIAL','FULFILLED','CANCELLED'))`);
    await q.query(`CREATE INDEX "ix_pharmacy_so_status" ON "pharmacy_sales_order" ("tenant_id","status")`);

    await q.query(
      createTenantTableSql('pharmacy_sales_order_item', [
        '"order_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"qty" integer NOT NULL',
        '"fulfilled_qty" integer NOT NULL DEFAULT 0',
        '"unit_price_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('pharmacy_sales_order_item');
    await q.query(`ALTER TABLE "pharmacy_sales_order_item" ADD CONSTRAINT "fk_pharmacy_so_item_order"
      FOREIGN KEY ("tenant_id","order_id") REFERENCES "pharmacy_sales_order"("tenant_id","id") ON DELETE CASCADE`);

    // ── Quantity-break price tiers (per drug/product) ─────────────────────────────
    await q.query(
      createTenantTableSql('pharmacy_price_tier', [
        '"product_id" uuid NOT NULL',
        '"min_qty" integer NOT NULL',
        '"unit_price_minor" bigint NOT NULL',
      ]),
    );
    await uq('pharmacy_price_tier');
    await q.query(`ALTER TABLE "pharmacy_price_tier" ADD CONSTRAINT "ck_pharmacy_price_tier_minqty" CHECK ("min_qty" >= 1)`);
    await q.query(`CREATE INDEX "ix_pharmacy_price_tier_product" ON "pharmacy_price_tier" ("tenant_id","product_id","min_qty")`);

    for (const t of [
      'pharmacy_ward_requisition', 'pharmacy_ward_requisition_item', 'pharmacy_sales_order',
      'pharmacy_sales_order_item', 'pharmacy_price_tier',
    ]) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'pharmacy_price_tier', 'pharmacy_sales_order_item', 'pharmacy_sales_order',
      'pharmacy_ward_requisition_item', 'pharmacy_ward_requisition',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
