import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Manufacturing / Production module — discrete production on top of the valued inventory ledger.
 *
 * `production_work_center` (labour+overhead cost rate) and `production_bom` (+ `_line` components,
 * `_operation` routing) define how a finished good is made. A `production_order` is a work order:
 * created from a BOM (materials + operations snapshotted, scaled to the planned qty), planned →
 * released → materials issued (each `production_order_material` decrements stock through the inventory
 * ledger, capturing actual WAVG cost) → completed (operation + overhead cost added; the finished good
 * is received back into stock at the computed unit cost). Per-tenant custom fields on orders are EAV
 * via `production_attribute` (+ `_value`) — the "preset + customized attributes" surface. All
 * tenant-scoped (RLS); money is integer minor units; numbers from `production_doc_seq`.
 */
export class Production1723200000000 implements MigrationInterface {
  name = 'Production1723200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "production_doc_seq" (
        "tenant_id" uuid NOT NULL, "doc_type" text NOT NULL, "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id","doc_type"))`);
    for (const stmt of enableTenantRlsSql('production_doc_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('production_doc_seq'));

    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fkProduct = (t: string, col: string, name: string, onDelete = 'RESTRICT') =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${name}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "inventory_product"("tenant_id","id") ON DELETE ${onDelete}`);

    // ── Work centers ────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('production_work_center', [
        '"name" text NOT NULL',
        '"code" text',
        '"cost_per_hour_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        `"status" text NOT NULL DEFAULT 'ACTIVE'`,
        '"notes" text',
      ]),
    );
    await uq('production_work_center');
    await q.query(`ALTER TABLE "production_work_center" ADD CONSTRAINT "ck_pwc_status" CHECK ("status" IN ('ACTIVE','INACTIVE'))`);

    // ── Bill of materials ───────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('production_bom', [
        '"bom_no" text NOT NULL',
        '"product_id" uuid NOT NULL',
        '"name" text NOT NULL',
        '"output_qty" integer NOT NULL DEFAULT 1',
        '"version" integer NOT NULL DEFAULT 1',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        '"overhead_pct" integer NOT NULL DEFAULT 0',
        '"notes" text',
      ]),
    );
    await uq('production_bom');
    await q.query(`ALTER TABLE "production_bom" ADD CONSTRAINT "ck_pbom_status" CHECK ("status" IN ('DRAFT','ACTIVE','ARCHIVED'))`);
    await q.query(`ALTER TABLE "production_bom" ADD CONSTRAINT "ck_pbom_output" CHECK ("output_qty" > 0)`);
    await q.query(`ALTER TABLE "production_bom" ADD CONSTRAINT "ck_pbom_overhead" CHECK ("overhead_pct" BETWEEN 0 AND 100)`);
    await q.query(`CREATE INDEX "ix_pbom_product" ON "production_bom" ("tenant_id","product_id")`);
    // At most one ACTIVE BOM per product.
    await q.query(`CREATE UNIQUE INDEX "ux_pbom_active" ON "production_bom" ("tenant_id","product_id")
      WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL`);
    await fkProduct('production_bom', 'product_id', 'pbom_product');

    await q.query(
      createTenantTableSql('production_bom_line', [
        '"bom_id" uuid NOT NULL',
        '"component_product_id" uuid NOT NULL',
        '"quantity" integer NOT NULL DEFAULT 1',
        '"scrap_pct" integer NOT NULL DEFAULT 0',
        '"notes" text',
      ]),
    );
    await uq('production_bom_line');
    await q.query(`ALTER TABLE "production_bom_line" ADD CONSTRAINT "ck_pboml_qty" CHECK ("quantity" > 0)`);
    await q.query(`ALTER TABLE "production_bom_line" ADD CONSTRAINT "ck_pboml_scrap" CHECK ("scrap_pct" BETWEEN 0 AND 100)`);
    await q.query(`CREATE INDEX "ix_pboml_bom" ON "production_bom_line" ("tenant_id","bom_id")`);
    await q.query(`ALTER TABLE "production_bom_line" ADD CONSTRAINT "fk_pboml_bom"
      FOREIGN KEY ("tenant_id","bom_id") REFERENCES "production_bom"("tenant_id","id") ON DELETE CASCADE`);
    await fkProduct('production_bom_line', 'component_product_id', 'pboml_component');

    await q.query(
      createTenantTableSql('production_bom_operation', [
        '"bom_id" uuid NOT NULL',
        '"work_center_id" uuid',
        '"sequence" integer NOT NULL DEFAULT 1',
        '"name" text NOT NULL',
        '"run_minutes" integer NOT NULL DEFAULT 0',
        '"notes" text',
      ]),
    );
    await uq('production_bom_operation');
    await q.query(`CREATE INDEX "ix_pbomop_bom" ON "production_bom_operation" ("tenant_id","bom_id")`);
    await q.query(`ALTER TABLE "production_bom_operation" ADD CONSTRAINT "fk_pbomop_bom"
      FOREIGN KEY ("tenant_id","bom_id") REFERENCES "production_bom"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "production_bom_operation" ADD CONSTRAINT "fk_pbomop_wc"
      FOREIGN KEY ("tenant_id","work_center_id") REFERENCES "production_work_center"("tenant_id","id") ON DELETE SET NULL`);

    // ── Production orders ───────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('production_order', [
        '"order_no" text NOT NULL',
        '"product_id" uuid NOT NULL',
        '"bom_id" uuid',
        '"warehouse_id" uuid',
        '"planned_qty" integer NOT NULL DEFAULT 1',
        '"produced_qty" integer NOT NULL DEFAULT 0',
        `"status" text NOT NULL DEFAULT 'DRAFT'`,
        `"priority" text NOT NULL DEFAULT 'NORMAL'`,
        '"overhead_pct" integer NOT NULL DEFAULT 0',
        '"planned_start" date',
        '"planned_end" date',
        '"actual_start" timestamptz',
        '"actual_end" timestamptz',
        '"material_cost_minor" bigint NOT NULL DEFAULT 0',
        '"operation_cost_minor" bigint NOT NULL DEFAULT 0',
        '"overhead_minor" bigint NOT NULL DEFAULT 0',
        '"total_cost_minor" bigint NOT NULL DEFAULT 0',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"notes" text',
      ]),
    );
    await uq('production_order');
    await q.query(`ALTER TABLE "production_order" ADD CONSTRAINT "ck_porder_status"
      CHECK ("status" IN ('DRAFT','PLANNED','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED'))`);
    await q.query(`ALTER TABLE "production_order" ADD CONSTRAINT "ck_porder_priority" CHECK ("priority" IN ('LOW','NORMAL','HIGH','URGENT'))`);
    await q.query(`ALTER TABLE "production_order" ADD CONSTRAINT "ck_porder_qty" CHECK ("planned_qty" > 0)`);
    await q.query(`CREATE INDEX "ix_porder_status" ON "production_order" ("tenant_id","status")`);
    await q.query(`CREATE INDEX "ix_porder_product" ON "production_order" ("tenant_id","product_id")`);
    await fkProduct('production_order', 'product_id', 'porder_product');
    await q.query(`ALTER TABLE "production_order" ADD CONSTRAINT "fk_porder_bom"
      FOREIGN KEY ("tenant_id","bom_id") REFERENCES "production_bom"("tenant_id","id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "production_order" ADD CONSTRAINT "fk_porder_warehouse"
      FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "inventory_warehouse"("tenant_id","id") ON DELETE SET NULL`);

    await q.query(
      createTenantTableSql('production_order_material', [
        '"order_id" uuid NOT NULL',
        '"component_product_id" uuid NOT NULL',
        '"required_qty" integer NOT NULL DEFAULT 0',
        '"issued_qty" integer NOT NULL DEFAULT 0',
        '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
        '"cost_minor" bigint NOT NULL DEFAULT 0',
      ]),
    );
    await uq('production_order_material');
    await q.query(`CREATE INDEX "ix_pomat_order" ON "production_order_material" ("tenant_id","order_id")`);
    await q.query(`ALTER TABLE "production_order_material" ADD CONSTRAINT "fk_pomat_order"
      FOREIGN KEY ("tenant_id","order_id") REFERENCES "production_order"("tenant_id","id") ON DELETE CASCADE`);
    await fkProduct('production_order_material', 'component_product_id', 'pomat_component');

    await q.query(
      createTenantTableSql('production_order_operation', [
        '"order_id" uuid NOT NULL',
        '"work_center_id" uuid',
        '"sequence" integer NOT NULL DEFAULT 1',
        '"name" text NOT NULL',
        '"planned_minutes" integer NOT NULL DEFAULT 0',
        '"actual_minutes" integer NOT NULL DEFAULT 0',
        '"cost_minor" bigint NOT NULL DEFAULT 0',
        `"status" text NOT NULL DEFAULT 'PENDING'`,
      ]),
    );
    await uq('production_order_operation');
    await q.query(`ALTER TABLE "production_order_operation" ADD CONSTRAINT "ck_poop_status" CHECK ("status" IN ('PENDING','DONE'))`);
    await q.query(`CREATE INDEX "ix_poop_order" ON "production_order_operation" ("tenant_id","order_id")`);
    await q.query(`ALTER TABLE "production_order_operation" ADD CONSTRAINT "fk_poop_order"
      FOREIGN KEY ("tenant_id","order_id") REFERENCES "production_order"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "production_order_operation" ADD CONSTRAINT "fk_poop_wc"
      FOREIGN KEY ("tenant_id","work_center_id") REFERENCES "production_work_center"("tenant_id","id") ON DELETE SET NULL`);

    // ── Custom attributes (EAV) on production orders ────────────────────────────
    await q.query(
      createTenantTableSql('production_attribute', [
        '"attr_key" text NOT NULL',
        '"label" text NOT NULL',
        `"data_type" text NOT NULL DEFAULT 'TEXT'`,
        '"options" text',
        '"required" boolean NOT NULL DEFAULT false',
        '"sort" integer NOT NULL DEFAULT 0',
      ]),
    );
    await uq('production_attribute');
    await q.query(`ALTER TABLE "production_attribute" ADD CONSTRAINT "ck_pattr_type"
      CHECK ("data_type" IN ('TEXT','NUMBER','DATE','BOOLEAN','SELECT'))`);
    await q.query(`CREATE UNIQUE INDEX "uq_pattr_key" ON "production_attribute" ("tenant_id",lower("attr_key"))`);

    await q.query(
      createTenantTableSql('production_attribute_value', [
        '"attribute_id" uuid NOT NULL',
        '"order_id" uuid NOT NULL',
        '"value" text',
      ]),
    );
    await uq('production_attribute_value');
    await q.query(`CREATE UNIQUE INDEX "uq_pattrval" ON "production_attribute_value" ("tenant_id","attribute_id","order_id")`);
    await q.query(`ALTER TABLE "production_attribute_value" ADD CONSTRAINT "fk_pattrval_attr"
      FOREIGN KEY ("tenant_id","attribute_id") REFERENCES "production_attribute"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "production_attribute_value" ADD CONSTRAINT "fk_pattrval_order"
      FOREIGN KEY ("tenant_id","order_id") REFERENCES "production_order"("tenant_id","id") ON DELETE CASCADE`);

    for (const t of [
      'production_work_center', 'production_bom', 'production_bom_line', 'production_bom_operation',
      'production_order', 'production_order_material', 'production_order_operation',
      'production_attribute', 'production_attribute_value',
    ]) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'production_attribute_value', 'production_attribute', 'production_order_operation',
      'production_order_material', 'production_order', 'production_bom_operation',
      'production_bom_line', 'production_bom', 'production_work_center', 'production_doc_seq',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
