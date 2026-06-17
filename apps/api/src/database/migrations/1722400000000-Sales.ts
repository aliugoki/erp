import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Sales module: the quote-to-order lifecycle on top of CRM accounts and the inventory catalogue.
 *
 * `sales_quotation` (+ `sales_quotation_line`) → DRAFT/SENT/ACCEPTED/REJECTED/EXPIRED/CONVERTED, with
 * subtotal/tax/total in minor units. An accepted quotation converts to a `sales_so` (sales order,
 * + `sales_so_line`) tracking per-line delivered quantity and a status
 * (DRAFT/CONFIRMED/PARTIALLY_DELIVERED/DELIVERED/INVOICED/CANCELLED). (The order table is `sales_so`,
 * not `sales_order`, which the order-to-cash saga module already owns.) Customer = crm_client
 * (composite FK); line product = inventory_product (optional, SET NULL). Numbered via `sales_doc_seq`.
 */
export class Sales1722400000000 implements MigrationInterface {
  name = 'Sales1722400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "sales_doc_seq" (
        "tenant_id" uuid NOT NULL, "doc_type" text NOT NULL, "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id","doc_type"))`);
    for (const stmt of enableTenantRlsSql('sales_doc_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('sales_doc_seq'));

    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fkClient = (t: string) =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_client"
        FOREIGN KEY ("tenant_id","client_id") REFERENCES "crm_client"("tenant_id","id") ON DELETE CASCADE`);
    const fkProduct = (t: string) =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_product"
        FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE SET NULL`);

    // ── Quotations ──────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('sales_quotation', [
        '"quote_no" text NOT NULL',
        '"client_id" uuid NOT NULL',
        '"deal_id" uuid',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"valid_until" date',
        '"tax_rate" integer NOT NULL DEFAULT 0',
        '"subtotal_minor" bigint NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"notes" text',
      ]),
    );
    await uq('sales_quotation');
    await q.query(`ALTER TABLE "sales_quotation" ADD CONSTRAINT "ck_sales_quotation_status" CHECK ("status" IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CONVERTED'))`);
    await q.query(`ALTER TABLE "sales_quotation" ADD CONSTRAINT "ck_sales_quotation_tax" CHECK ("tax_rate" BETWEEN 0 AND 100)`);
    await q.query(`CREATE INDEX "ix_sales_quotation_status" ON "sales_quotation" ("tenant_id","status")`);
    await fkClient('sales_quotation');

    await q.query(
      createTenantTableSql('sales_quotation_line', [
        '"quotation_id" uuid NOT NULL',
        '"product_id" uuid',
        '"description" text NOT NULL',
        '"quantity" integer NOT NULL DEFAULT 1',
        '"unit_price_minor" bigint NOT NULL DEFAULT 0',
        '"line_total_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('sales_quotation_line');
    await q.query(`ALTER TABLE "sales_quotation_line" ADD CONSTRAINT "ck_sales_quotation_line_qty" CHECK ("quantity" > 0)`);
    await q.query(`CREATE INDEX "ix_sales_quotation_line_q" ON "sales_quotation_line" ("tenant_id","quotation_id")`);
    await q.query(`ALTER TABLE "sales_quotation_line" ADD CONSTRAINT "fk_sales_quotation_line_q"
      FOREIGN KEY ("tenant_id","quotation_id") REFERENCES "sales_quotation"("tenant_id","id") ON DELETE CASCADE`);
    await fkProduct('sales_quotation_line');

    // ── Sales orders (sales_so) ─────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('sales_so', [
        '"so_no" text NOT NULL',
        '"client_id" uuid NOT NULL',
        '"quotation_id" uuid',
        `"status" text NOT NULL DEFAULT 'CONFIRMED'`,
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"order_date" date NOT NULL DEFAULT current_date',
        '"expected_date" date',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"notes" text',
      ]),
    );
    await uq('sales_so');
    await q.query(`ALTER TABLE "sales_so" ADD CONSTRAINT "ck_sales_so_status" CHECK ("status" IN ('DRAFT','CONFIRMED','PARTIALLY_DELIVERED','DELIVERED','INVOICED','CANCELLED'))`);
    await q.query(`CREATE INDEX "ix_sales_so_status" ON "sales_so" ("tenant_id","status")`);
    await fkClient('sales_so');

    await q.query(
      createTenantTableSql('sales_so_line', [
        '"order_id" uuid NOT NULL',
        '"product_id" uuid',
        '"description" text NOT NULL',
        '"quantity" integer NOT NULL DEFAULT 1',
        '"delivered_qty" integer NOT NULL DEFAULT 0',
        '"unit_price_minor" bigint NOT NULL DEFAULT 0',
        '"line_total_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('sales_so_line');
    await q.query(`ALTER TABLE "sales_so_line" ADD CONSTRAINT "ck_sales_so_line_qty" CHECK ("quantity" > 0)`);
    await q.query(`CREATE INDEX "ix_sales_so_line_o" ON "sales_so_line" ("tenant_id","order_id")`);
    await q.query(`ALTER TABLE "sales_so_line" ADD CONSTRAINT "fk_sales_so_line_o"
      FOREIGN KEY ("tenant_id","order_id") REFERENCES "sales_so"("tenant_id","id") ON DELETE CASCADE`);
    await fkProduct('sales_so_line');

    for (const t of ['sales_quotation', 'sales_quotation_line', 'sales_so', 'sales_so_line']) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['sales_so_line', 'sales_so', 'sales_quotation_line', 'sales_quotation', 'sales_doc_seq']) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
