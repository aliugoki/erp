import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Enterprise inventory: a valued movement ledger (weighted-average cost) plus the document chain
 * Requisition → Purchase Order → GRN (receipt) and Issuance → Material Return Note, with Gate Passes.
 *
 * The backbone is `inventory_ledger`: every stock movement (opening, adjustment, GRN, issue, MRN)
 * appends one valued row carrying the running global balance qty + value for the product. The existing
 * `inventory_product.on_hand` stays in sync (its `CHECK (on_hand >= 0)` still guards overselling); a new
 * `stock_value_minor` column holds the running stock value so the WAVG unit cost = value / qty.
 *
 * Document numbers come from `inventory_doc_seq` (per-tenant, per-doc-type running counter), mirroring
 * `finance_voucher_seq`. Money is bigint minor units; FKs are composite (tenant_id, id); RLS on every
 * table. Idempotent: column adds use IF NOT EXISTS; table creates run once via the migration ledger.
 */
export class InventoryEnterprise1721500000000 implements MigrationInterface {
  name = 'InventoryEnterprise1721500000000';

  public async up(q: QueryRunner): Promise<void> {
    // Stock master: carry a running value so WAVG unit cost = stock_value_minor / on_hand.
    await q.query(`ALTER TABLE "inventory_product" ADD COLUMN IF NOT EXISTS "stock_value_minor" bigint NOT NULL DEFAULT 0`);

    // Per-tenant, per-doc-type running counter (REQ/PO/GRN/GP/ISS/MRN/ADJ).
    await q.query(`
      CREATE TABLE IF NOT EXISTS "inventory_doc_seq" (
        "tenant_id" uuid NOT NULL,
        "doc_type" text NOT NULL,
        "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id", "doc_type")
      )
    `);
    for (const stmt of enableTenantRlsSql('inventory_doc_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('inventory_doc_seq'));

    // ── Valued movement ledger (the backbone) ──────────────────────────────────
    await q.query(
      createTenantTableSql('inventory_ledger', [
        '"product_id" uuid NOT NULL',
        '"warehouse_id" uuid',
        '"doc_type" text NOT NULL',
        '"doc_id" uuid',
        '"doc_no" text',
        '"qty_in" integer NOT NULL DEFAULT 0',
        '"qty_out" integer NOT NULL DEFAULT 0',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
        '"value_in_minor" bigint NOT NULL DEFAULT 0',
        '"value_out_minor" bigint NOT NULL DEFAULT 0',
        '"balance_qty" integer NOT NULL DEFAULT 0',
        '"balance_value_minor" bigint NOT NULL DEFAULT 0',
        '"occurred_on" date NOT NULL DEFAULT current_date',
        '"narration" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_ledger" ADD CONSTRAINT "uq_inventory_ledger_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX "ix_inventory_ledger_product" ON "inventory_ledger" ("tenant_id","product_id","created_at")`);
    await q.query(`CREATE INDEX "ix_inventory_ledger_doc" ON "inventory_ledger" ("tenant_id","doc_type","doc_id")`);
    await q.query(
      `ALTER TABLE "inventory_ledger" ADD CONSTRAINT "fk_inventory_ledger_product"
       FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "inventory_ledger" ADD CONSTRAINT "fk_inventory_ledger_warehouse"
       FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "inventory_warehouse"("tenant_id","id") ON DELETE SET NULL`,
    );

    // ── Requisition (internal material request) ────────────────────────────────
    await q.query(
      createTenantTableSql('inventory_requisition', [
        '"req_no" text NOT NULL',
        '"warehouse_id" uuid',
        '"requested_by" text',
        '"department" text',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"needed_by" date',
        '"notes" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_requisition" ADD CONSTRAINT "uq_inventory_requisition_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_inventory_requisition_no" ON "inventory_requisition" ("tenant_id", lower("req_no"))`);
    await q.query(
      `ALTER TABLE "inventory_requisition" ADD CONSTRAINT "ck_inventory_requisition_status"
       CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','ISSUED','CANCELLED'))`,
    );
    await q.query(
      createTenantTableSql('inventory_requisition_item', [
        '"requisition_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"qty" integer NOT NULL',
        '"issued_qty" integer NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`CREATE INDEX "ix_inventory_requisition_item" ON "inventory_requisition_item" ("tenant_id","requisition_id")`);
    await q.query(`ALTER TABLE "inventory_requisition_item" ADD CONSTRAINT "ck_inventory_requisition_item_qty" CHECK ("qty" > 0)`);
    await q.query(
      `ALTER TABLE "inventory_requisition_item" ADD CONSTRAINT "fk_inventory_requisition_item_req"
       FOREIGN KEY ("tenant_id","requisition_id") REFERENCES "inventory_requisition"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "inventory_requisition_item" ADD CONSTRAINT "fk_inventory_requisition_item_product"
       FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE RESTRICT`,
    );

    // ── Purchase order ─────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('inventory_purchase_order', [
        '"po_no" text NOT NULL',
        '"vendor_id" uuid',
        '"requisition_id" uuid',
        '"warehouse_id" uuid',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"total_minor" bigint NOT NULL DEFAULT 0',
        '"expected_on" date',
        '"notes" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_purchase_order" ADD CONSTRAINT "uq_inventory_po_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_inventory_po_no" ON "inventory_purchase_order" ("tenant_id", lower("po_no"))`);
    await q.query(
      `ALTER TABLE "inventory_purchase_order" ADD CONSTRAINT "ck_inventory_po_status"
       CHECK ("status" IN ('DRAFT','APPROVED','PARTIAL','RECEIVED','CLOSED','CANCELLED'))`,
    );
    await q.query(
      createTenantTableSql('inventory_po_item', [
        '"po_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"qty" integer NOT NULL',
        '"received_qty" integer NOT NULL DEFAULT 0',
        '"unit_price_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`CREATE INDEX "ix_inventory_po_item" ON "inventory_po_item" ("tenant_id","po_id")`);
    await q.query(`ALTER TABLE "inventory_po_item" ADD CONSTRAINT "ck_inventory_po_item_qty" CHECK ("qty" > 0)`);
    await q.query(
      `ALTER TABLE "inventory_po_item" ADD CONSTRAINT "fk_inventory_po_item_po"
       FOREIGN KEY ("tenant_id","po_id") REFERENCES "inventory_purchase_order"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "inventory_po_item" ADD CONSTRAINT "fk_inventory_po_item_product"
       FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE RESTRICT`,
    );

    // ── Gate pass (inward / outward goods movement) ────────────────────────────
    await q.query(
      createTenantTableSql('inventory_gate_pass', [
        '"gp_no" text NOT NULL',
        `"direction" text NOT NULL`,
        '"returnable" boolean NOT NULL DEFAULT false',
        '"party" text',
        '"vehicle_no" text',
        `"status" text NOT NULL DEFAULT 'OPEN'`,
        '"issued_on" date NOT NULL DEFAULT current_date',
        '"remarks" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_gate_pass" ADD CONSTRAINT "uq_inventory_gate_pass_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_inventory_gate_pass_no" ON "inventory_gate_pass" ("tenant_id", lower("gp_no"))`);
    await q.query(
      `ALTER TABLE "inventory_gate_pass" ADD CONSTRAINT "ck_inventory_gate_pass_dir" CHECK ("direction" IN ('INWARD','OUTWARD'))`,
    );
    await q.query(
      `ALTER TABLE "inventory_gate_pass" ADD CONSTRAINT "ck_inventory_gate_pass_status" CHECK ("status" IN ('OPEN','CLOSED','CANCELLED'))`,
    );
    await q.query(
      createTenantTableSql('inventory_gate_pass_item', [
        '"gate_pass_id" uuid NOT NULL',
        '"product_id" uuid',
        '"description" text NOT NULL',
        '"qty" integer NOT NULL',
      ]),
    );
    await q.query(`CREATE INDEX "ix_inventory_gate_pass_item" ON "inventory_gate_pass_item" ("tenant_id","gate_pass_id")`);
    await q.query(
      `ALTER TABLE "inventory_gate_pass_item" ADD CONSTRAINT "fk_inventory_gate_pass_item_gp"
       FOREIGN KEY ("tenant_id","gate_pass_id") REFERENCES "inventory_gate_pass"("tenant_id","id") ON DELETE CASCADE`,
    );

    // ── GRN (Goods Receipt Note — receives a PO into stock) ────────────────────
    await q.query(
      createTenantTableSql('inventory_grn', [
        '"grn_no" text NOT NULL',
        '"po_id" uuid',
        '"vendor_id" uuid',
        '"warehouse_id" uuid',
        '"gate_pass_id" uuid',
        `"status" text NOT NULL DEFAULT 'POSTED'`,
        '"received_on" date NOT NULL DEFAULT current_date',
        '"notes" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_grn" ADD CONSTRAINT "uq_inventory_grn_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_inventory_grn_no" ON "inventory_grn" ("tenant_id", lower("grn_no"))`);
    await q.query(
      createTenantTableSql('inventory_grn_item', [
        '"grn_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"qty" integer NOT NULL',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`CREATE INDEX "ix_inventory_grn_item" ON "inventory_grn_item" ("tenant_id","grn_id")`);
    await q.query(`ALTER TABLE "inventory_grn_item" ADD CONSTRAINT "ck_inventory_grn_item_qty" CHECK ("qty" > 0)`);
    await q.query(
      `ALTER TABLE "inventory_grn_item" ADD CONSTRAINT "fk_inventory_grn_item_grn"
       FOREIGN KEY ("tenant_id","grn_id") REFERENCES "inventory_grn"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "inventory_grn_item" ADD CONSTRAINT "fk_inventory_grn_item_product"
       FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE RESTRICT`,
    );

    // ── Store issuance (issues stock out, optionally against a requisition) ─────
    await q.query(
      createTenantTableSql('inventory_issue', [
        '"issue_no" text NOT NULL',
        '"requisition_id" uuid',
        '"warehouse_id" uuid',
        '"issued_to" text',
        '"department" text',
        `"status" text NOT NULL DEFAULT 'POSTED'`,
        '"issued_on" date NOT NULL DEFAULT current_date',
        '"notes" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_issue" ADD CONSTRAINT "uq_inventory_issue_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_inventory_issue_no" ON "inventory_issue" ("tenant_id", lower("issue_no"))`);
    await q.query(
      createTenantTableSql('inventory_issue_item', [
        '"issue_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"qty" integer NOT NULL',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
        '"returned_qty" integer NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`CREATE INDEX "ix_inventory_issue_item" ON "inventory_issue_item" ("tenant_id","issue_id")`);
    await q.query(`ALTER TABLE "inventory_issue_item" ADD CONSTRAINT "ck_inventory_issue_item_qty" CHECK ("qty" > 0)`);
    await q.query(
      `ALTER TABLE "inventory_issue_item" ADD CONSTRAINT "fk_inventory_issue_item_issue"
       FOREIGN KEY ("tenant_id","issue_id") REFERENCES "inventory_issue"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "inventory_issue_item" ADD CONSTRAINT "fk_inventory_issue_item_product"
       FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE RESTRICT`,
    );

    // ── Material Return Note (returns issued stock back to the store) ───────────
    await q.query(
      createTenantTableSql('inventory_mrn', [
        '"mrn_no" text NOT NULL',
        '"issue_id" uuid',
        '"warehouse_id" uuid',
        '"returned_by" text',
        `"status" text NOT NULL DEFAULT 'POSTED'`,
        '"returned_on" date NOT NULL DEFAULT current_date',
        '"notes" text',
      ]),
    );
    await q.query(`ALTER TABLE "inventory_mrn" ADD CONSTRAINT "uq_inventory_mrn_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_inventory_mrn_no" ON "inventory_mrn" ("tenant_id", lower("mrn_no"))`);
    await q.query(
      createTenantTableSql('inventory_mrn_item', [
        '"mrn_id" uuid NOT NULL',
        '"product_id" uuid NOT NULL',
        '"qty" integer NOT NULL',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await q.query(`CREATE INDEX "ix_inventory_mrn_item" ON "inventory_mrn_item" ("tenant_id","mrn_id")`);
    await q.query(`ALTER TABLE "inventory_mrn_item" ADD CONSTRAINT "ck_inventory_mrn_item_qty" CHECK ("qty" > 0)`);
    await q.query(
      `ALTER TABLE "inventory_mrn_item" ADD CONSTRAINT "fk_inventory_mrn_item_mrn"
       FOREIGN KEY ("tenant_id","mrn_id") REFERENCES "inventory_mrn"("tenant_id","id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "inventory_mrn_item" ADD CONSTRAINT "fk_inventory_mrn_item_product"
       FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory_product"("tenant_id","id") ON DELETE RESTRICT`,
    );

    const tables = [
      'inventory_ledger',
      'inventory_requisition', 'inventory_requisition_item',
      'inventory_purchase_order', 'inventory_po_item',
      'inventory_gate_pass', 'inventory_gate_pass_item',
      'inventory_grn', 'inventory_grn_item',
      'inventory_issue', 'inventory_issue_item',
      'inventory_mrn', 'inventory_mrn_item',
    ];
    for (const table of tables) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const tables = [
      'inventory_mrn_item', 'inventory_mrn',
      'inventory_issue_item', 'inventory_issue',
      'inventory_grn_item', 'inventory_grn',
      'inventory_gate_pass_item', 'inventory_gate_pass',
      'inventory_po_item', 'inventory_purchase_order',
      'inventory_requisition_item', 'inventory_requisition',
      'inventory_ledger', 'inventory_doc_seq',
    ];
    for (const table of tables) await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    await q.query(`ALTER TABLE "inventory_product" DROP COLUMN IF EXISTS "stock_value_minor"`);
  }
}
