import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * E-commerce module — a Shopify-style online store layered over the ERP. Tenant-scoped (RLS), money in
 * integer minor units. Catalogue listings (`ec_product`) reference an `inventory_product` for stock +
 * base cost; the storefront is public (reached by the tenant slug) but only when `ec_store.published`.
 *
 * Tables: ec_store (one per tenant), ec_collection, ec_product (+ ec_product_image, ec_product_collection),
 * ec_discount, ec_cart (+ ec_cart_item), ec_order (+ ec_order_line), ec_gl_config (one per tenant),
 * ec_doc_seq (order numbering). Cross-module references (inventory_product, crm_client) are stored as
 * plain uuids — RLS + app logic enforce integrity; FKs are kept within ec_* and to app_attachment.
 */
export class Ecommerce1724100000000 implements MigrationInterface {
  name = 'Ecommerce1724100000000';

  public async up(q: QueryRunner): Promise<void> {
    // Helper: a tenant-scoped table with the composite unique key needed for in-module FKs + RLS + grant.
    const table = async (name: string, cols: string[]): Promise<void> => {
      await q.query(createTenantTableSql(name, cols));
      await q.query(`ALTER TABLE "${name}" ADD CONSTRAINT "uq_${name}_tenant_id" UNIQUE ("tenant_id","id")`);
      for (const stmt of enableTenantRlsSql(name)) await q.query(stmt);
      await q.query(grantAppUserSql(name));
    };

    // ── Store settings (one row per tenant) ─────────────────────────────────────
    await table('ec_store', [
      '"name" text NOT NULL',
      '"tagline" text',
      '"description" text',
      `"currency" text NOT NULL DEFAULT 'PKR'`,
      `"accent_color" text NOT NULL DEFAULT '#4f46e5'`,
      '"logo_attachment_id" uuid',
      '"hero_attachment_id" uuid',
      '"hero_headline" text',
      '"hero_subtext" text',
      '"support_email" text',
      '"support_phone" text',
      '"address" text',
      '"default_tax_rate" integer NOT NULL DEFAULT 0',
      '"shipping_flat_minor" bigint NOT NULL DEFAULT 0',
      '"free_shipping_over_minor" bigint',
      '"published" boolean NOT NULL DEFAULT false',
    ]);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_store_tenant" ON "ec_store" ("tenant_id")`);
    await q.query(`ALTER TABLE "ec_store" ADD CONSTRAINT "fk_ec_store_logo"
      FOREIGN KEY ("tenant_id","logo_attachment_id") REFERENCES "app_attachment"("tenant_id","id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "ec_store" ADD CONSTRAINT "fk_ec_store_hero"
      FOREIGN KEY ("tenant_id","hero_attachment_id") REFERENCES "app_attachment"("tenant_id","id") ON DELETE SET NULL`);

    // ── Collections (catalog groupings) ─────────────────────────────────────────
    await table('ec_collection', [
      '"title" text NOT NULL',
      '"slug" text NOT NULL',
      '"description" text',
      '"sort" integer NOT NULL DEFAULT 0',
      '"is_featured" boolean NOT NULL DEFAULT false',
    ]);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_collection_slug" ON "ec_collection" ("tenant_id","slug") WHERE deleted_at IS NULL`);

    // ── Products (online listing over an inventory_product) ──────────────────────
    await table('ec_product', [
      '"product_id" uuid NOT NULL',
      '"slug" text NOT NULL',
      '"title" text NOT NULL',
      '"subtitle" text',
      '"description" text',
      '"price_minor" bigint',
      '"compare_at_minor" bigint',
      `"status" text NOT NULL DEFAULT 'DRAFT'`,
      '"is_featured" boolean NOT NULL DEFAULT false',
      '"sort" integer NOT NULL DEFAULT 0',
      '"tax_rate" integer NOT NULL DEFAULT 0',
    ]);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_product_slug" ON "ec_product" ("tenant_id","slug") WHERE deleted_at IS NULL`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_product_inv" ON "ec_product" ("tenant_id","product_id") WHERE deleted_at IS NULL`);
    await q.query(`ALTER TABLE "ec_product" ADD CONSTRAINT "ck_ec_product_status" CHECK ("status" IN ('DRAFT','ACTIVE','ARCHIVED'))`);

    await table('ec_product_image', [
      '"product_id" uuid NOT NULL',
      '"attachment_id" uuid NOT NULL',
      '"sort" integer NOT NULL DEFAULT 0',
      '"is_primary" boolean NOT NULL DEFAULT false',
    ]);
    await q.query(`ALTER TABLE "ec_product_image" ADD CONSTRAINT "fk_ec_product_image_product"
      FOREIGN KEY ("tenant_id","product_id") REFERENCES "ec_product"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "ec_product_image" ADD CONSTRAINT "fk_ec_product_image_attachment"
      FOREIGN KEY ("tenant_id","attachment_id") REFERENCES "app_attachment"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE INDEX "ix_ec_product_image_product" ON "ec_product_image" ("tenant_id","product_id")`);

    await table('ec_product_collection', [
      '"product_id" uuid NOT NULL',
      '"collection_id" uuid NOT NULL',
    ]);
    await q.query(`ALTER TABLE "ec_product_collection" ADD CONSTRAINT "fk_ec_pc_product"
      FOREIGN KEY ("tenant_id","product_id") REFERENCES "ec_product"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "ec_product_collection" ADD CONSTRAINT "fk_ec_pc_collection"
      FOREIGN KEY ("tenant_id","collection_id") REFERENCES "ec_collection"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_pc" ON "ec_product_collection" ("tenant_id","product_id","collection_id")`);

    // ── Discounts (coupon codes) ────────────────────────────────────────────────
    await table('ec_discount', [
      '"code" text NOT NULL',
      `"type" text NOT NULL DEFAULT 'PERCENT'`,
      '"value" bigint NOT NULL',
      '"active" boolean NOT NULL DEFAULT true',
      '"min_subtotal_minor" bigint NOT NULL DEFAULT 0',
      '"starts_at" timestamptz',
      '"ends_at" timestamptz',
      '"usage_limit" integer',
      '"used_count" integer NOT NULL DEFAULT 0',
    ]);
    await q.query(`ALTER TABLE "ec_discount" ADD CONSTRAINT "ck_ec_discount_type" CHECK ("type" IN ('PERCENT','FIXED'))`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_discount_code" ON "ec_discount" ("tenant_id", upper("code")) WHERE deleted_at IS NULL`);

    // ── Cart (server-side; storefront keeps the token) ──────────────────────────
    await table('ec_cart', [
      '"token" text NOT NULL',
      `"status" text NOT NULL DEFAULT 'OPEN'`,
      '"discount_code" text',
    ]);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_cart_token" ON "ec_cart" ("tenant_id","token")`);

    await table('ec_cart_item', [
      '"cart_id" uuid NOT NULL',
      '"product_id" uuid NOT NULL',
      '"quantity" integer NOT NULL',
      '"unit_price_minor" bigint NOT NULL',
    ]);
    await q.query(`ALTER TABLE "ec_cart_item" ADD CONSTRAINT "fk_ec_cart_item_cart"
      FOREIGN KEY ("tenant_id","cart_id") REFERENCES "ec_cart"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_cart_item" ON "ec_cart_item" ("tenant_id","cart_id","product_id")`);

    // ── Orders ──────────────────────────────────────────────────────────────────
    await table('ec_order', [
      '"order_no" text NOT NULL',
      '"cart_id" uuid',
      '"client_id" uuid',
      '"customer_name" text NOT NULL',
      '"customer_email" text NOT NULL',
      '"customer_phone" text',
      '"shipping_address" text',
      '"shipping_city" text',
      '"shipping_country" text',
      `"status" text NOT NULL DEFAULT 'PENDING'`,
      '"payment_method" text NOT NULL',
      `"payment_status" text NOT NULL DEFAULT 'UNPAID'`,
      '"payment_reference" text',
      '"subtotal_minor" bigint NOT NULL DEFAULT 0',
      '"discount_minor" bigint NOT NULL DEFAULT 0',
      '"tax_minor" bigint NOT NULL DEFAULT 0',
      '"shipping_minor" bigint NOT NULL DEFAULT 0',
      '"total_minor" bigint NOT NULL DEFAULT 0',
      '"cogs_minor" bigint NOT NULL DEFAULT 0',
      `"currency" text NOT NULL DEFAULT 'PKR'`,
      '"discount_code" text',
      '"warehouse_id" uuid',
      '"placed_at" timestamptz',
    ]);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_order_no" ON "ec_order" ("tenant_id","order_no")`);
    await q.query(`CREATE INDEX "ix_ec_order_status" ON "ec_order" ("tenant_id","status")`);
    await q.query(`CREATE INDEX "ix_ec_order_email" ON "ec_order" ("tenant_id", lower("customer_email"))`);

    await table('ec_order_line', [
      '"order_id" uuid NOT NULL',
      '"ec_product_id" uuid',
      '"product_id" uuid',
      '"title" text NOT NULL',
      '"quantity" integer NOT NULL',
      '"unit_price_minor" bigint NOT NULL',
      '"tax_rate" integer NOT NULL DEFAULT 0',
      '"tax_minor" bigint NOT NULL DEFAULT 0',
      '"line_total_minor" bigint NOT NULL DEFAULT 0',
      '"unit_cost_minor" bigint NOT NULL DEFAULT 0',
    ]);
    await q.query(`ALTER TABLE "ec_order_line" ADD CONSTRAINT "fk_ec_order_line_order"
      FOREIGN KEY ("tenant_id","order_id") REFERENCES "ec_order"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE INDEX "ix_ec_order_line_order" ON "ec_order_line" ("tenant_id","order_id")`);

    // ── GL posting config (one row per tenant) ──────────────────────────────────
    await table('ec_gl_config', [
      '"clearing_account_id" uuid',
      '"revenue_account_id" uuid',
      '"tax_account_id" uuid',
      '"cogs_account_id" uuid',
      '"inventory_account_id" uuid',
      '"shipping_account_id" uuid',
    ]);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_gl_config_tenant" ON "ec_gl_config" ("tenant_id")`);

    // ── Order numbering ─────────────────────────────────────────────────────────
    await table('ec_doc_seq', [
      '"doc_type" text NOT NULL',
      '"last_no" bigint NOT NULL DEFAULT 0',
    ]);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_doc_seq" ON "ec_doc_seq" ("tenant_id","doc_type")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'ec_doc_seq', 'ec_gl_config', 'ec_order_line', 'ec_order', 'ec_cart_item', 'ec_cart',
      'ec_discount', 'ec_product_collection', 'ec_product_image', 'ec_product', 'ec_collection', 'ec_store',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
