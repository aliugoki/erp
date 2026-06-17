import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Point of Sale (POS) — the retail counter on top of inventory + CRM.
 *
 * `pos_register` (a till/terminal, optionally bound to an inventory warehouse) → cashiers open a
 * `pos_shift` (cash session: opening float → cash reconciliation + variance on close) → each
 * `pos_sale` (+ `pos_sale_line`, `pos_payment`) rings up priced lines, decrements stock through the
 * inventory ledger (COGS captured per line), and is settled by one or more tenders. A sale can be
 * PARKED (held), COMPLETED, VOIDED, or (partially) REFUNDED via a RETURN-type sale that points back at
 * the original. Money is integer minor units; numbers come from `pos_doc_seq`. All tenant-scoped (RLS).
 */
export class Pos1723000000000 implements MigrationInterface {
  name = 'Pos1723000000000';

  public async up(q: QueryRunner): Promise<void> {
    // Per-tenant, per-type document counter (shift + sale numbers).
    await q.query(`
      CREATE TABLE IF NOT EXISTS "pos_doc_seq" (
        "tenant_id" uuid NOT NULL, "doc_type" text NOT NULL, "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id","doc_type"))`);
    for (const stmt of enableTenantRlsSql('pos_doc_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('pos_doc_seq'));

    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);

    // ── Registers (tills) ───────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('pos_register', [
        '"name" text NOT NULL',
        '"code" text',
        '"warehouse_id" uuid',
        '"location" text',
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
        `"currency" text NOT NULL DEFAULT 'PKR'`,
      ]),
    );
    await uq('pos_register');
    await q.query(`ALTER TABLE "pos_register" ADD CONSTRAINT "ck_pos_register_status" CHECK ("status" IN ('ACTIVE','INACTIVE'))`);
    await q.query(`ALTER TABLE "pos_register" ADD CONSTRAINT "fk_pos_register_warehouse"
      FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "inventory_warehouse"("tenant_id","id") ON DELETE SET NULL`);

    // ── Shifts (cash sessions) ──────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('pos_shift', [
        '"shift_no" text NOT NULL',
        '"register_id" uuid NOT NULL',
        '"cashier_id" uuid',
        `"status" text NOT NULL DEFAULT 'OPEN'`,
        '"opened_at" timestamptz NOT NULL DEFAULT now()',
        '"opening_float_minor" bigint NOT NULL DEFAULT 0',
        '"closed_at" timestamptz',
        '"counted_cash_minor" bigint',
        '"expected_cash_minor" bigint',
        '"variance_minor" bigint',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"notes" text',
      ]),
    );
    await uq('pos_shift');
    await q.query(`ALTER TABLE "pos_shift" ADD CONSTRAINT "ck_pos_shift_status" CHECK ("status" IN ('OPEN','CLOSED'))`);
    await q.query(`CREATE INDEX "ix_pos_shift_register" ON "pos_shift" ("tenant_id","register_id","status")`);
    await q.query(`ALTER TABLE "pos_shift" ADD CONSTRAINT "fk_pos_shift_register"
      FOREIGN KEY ("tenant_id","register_id") REFERENCES "pos_register"("tenant_id","id") ON DELETE CASCADE`);
    // At most one OPEN shift per register.
    await q.query(`CREATE UNIQUE INDEX "ux_pos_shift_open" ON "pos_shift" ("tenant_id","register_id")
      WHERE "status" = 'OPEN' AND "deleted_at" IS NULL`);

    // ── Sales ───────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('pos_sale', [
        '"sale_no" text NOT NULL',
        '"register_id" uuid NOT NULL',
        '"shift_id" uuid NOT NULL',
        '"client_id" uuid',
        '"customer_name" text',
        `"type" text NOT NULL DEFAULT 'SALE'`,
        '"original_sale_id" uuid',
        `"status" text NOT NULL DEFAULT 'COMPLETED'`,
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"subtotal_minor" bigint NOT NULL DEFAULT 0',
        '"discount_minor" bigint NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"paid_minor" bigint NOT NULL DEFAULT 0',
        '"change_minor" bigint NOT NULL DEFAULT 0',
        '"cogs_minor" bigint NOT NULL DEFAULT 0',
        '"refunded_minor" bigint NOT NULL DEFAULT 0',
        '"sold_at" timestamptz NOT NULL DEFAULT now()',
        '"sold_by" uuid',
        '"notes" text',
      ]),
    );
    await uq('pos_sale');
    await q.query(`ALTER TABLE "pos_sale" ADD CONSTRAINT "ck_pos_sale_type" CHECK ("type" IN ('SALE','RETURN'))`);
    await q.query(`ALTER TABLE "pos_sale" ADD CONSTRAINT "ck_pos_sale_status"
      CHECK ("status" IN ('PARKED','COMPLETED','VOIDED','REFUNDED','PARTIALLY_REFUNDED'))`);
    await q.query(`CREATE INDEX "ix_pos_sale_shift" ON "pos_sale" ("tenant_id","shift_id")`);
    await q.query(`CREATE INDEX "ix_pos_sale_sold_at" ON "pos_sale" ("tenant_id","sold_at")`);
    await q.query(`ALTER TABLE "pos_sale" ADD CONSTRAINT "fk_pos_sale_register"
      FOREIGN KEY ("tenant_id","register_id") REFERENCES "pos_register"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "pos_sale" ADD CONSTRAINT "fk_pos_sale_shift"
      FOREIGN KEY ("tenant_id","shift_id") REFERENCES "pos_shift"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "pos_sale" ADD CONSTRAINT "fk_pos_sale_client"
      FOREIGN KEY ("tenant_id","client_id") REFERENCES "crm_client"("tenant_id","id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "pos_sale" ADD CONSTRAINT "fk_pos_sale_original"
      FOREIGN KEY ("tenant_id","original_sale_id") REFERENCES "pos_sale"("tenant_id","id") ON DELETE SET NULL`);

    // ── Sale lines ──────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('pos_sale_line', [
        '"sale_id" uuid NOT NULL',
        '"product_id" uuid',
        '"description" text NOT NULL',
        '"quantity" integer NOT NULL DEFAULT 1',
        '"unit_price_minor" bigint NOT NULL DEFAULT 0',
        '"discount_minor" bigint NOT NULL DEFAULT 0',
        '"tax_rate" integer NOT NULL DEFAULT 0',
        '"tax_minor" bigint NOT NULL DEFAULT 0',
        '"line_total_minor" bigint NOT NULL DEFAULT 0',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
        '"returned_qty" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('pos_sale_line');
    await q.query(`ALTER TABLE "pos_sale_line" ADD CONSTRAINT "ck_pos_sale_line_qty" CHECK ("quantity" > 0)`);
    await q.query(`ALTER TABLE "pos_sale_line" ADD CONSTRAINT "ck_pos_sale_line_tax" CHECK ("tax_rate" BETWEEN 0 AND 100)`);
    await q.query(`CREATE INDEX "ix_pos_sale_line_sale" ON "pos_sale_line" ("tenant_id","sale_id")`);
    await q.query(`CREATE INDEX "ix_pos_sale_line_product" ON "pos_sale_line" ("tenant_id","product_id")`);
    await q.query(`ALTER TABLE "pos_sale_line" ADD CONSTRAINT "fk_pos_sale_line_sale"
      FOREIGN KEY ("tenant_id","sale_id") REFERENCES "pos_sale"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "pos_sale_line" ADD CONSTRAINT "fk_pos_sale_line_product"
      FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE SET NULL`);

    // ── Payments (tenders) ──────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('pos_payment', [
        '"sale_id" uuid NOT NULL',
        '"method" text NOT NULL',
        '"amount_minor" bigint NOT NULL',
        '"reference" text',
        '"paid_at" timestamptz NOT NULL DEFAULT now()',
      ]),
    );
    await uq('pos_payment');
    await q.query(`ALTER TABLE "pos_payment" ADD CONSTRAINT "ck_pos_payment_method"
      CHECK ("method" IN ('CASH','CARD','MOBILE','WALLET','BANK','CREDIT','VOUCHER'))`);
    await q.query(`CREATE INDEX "ix_pos_payment_sale" ON "pos_payment" ("tenant_id","sale_id")`);
    await q.query(`ALTER TABLE "pos_payment" ADD CONSTRAINT "fk_pos_payment_sale"
      FOREIGN KEY ("tenant_id","sale_id") REFERENCES "pos_sale"("tenant_id","id") ON DELETE CASCADE`);

    for (const t of ['pos_register', 'pos_shift', 'pos_sale', 'pos_sale_line', 'pos_payment']) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['pos_payment', 'pos_sale_line', 'pos_sale', 'pos_shift', 'pos_register', 'pos_doc_seq']) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
