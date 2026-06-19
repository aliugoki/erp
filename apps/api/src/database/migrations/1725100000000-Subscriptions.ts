import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Subscriptions & recurring billing. Plans define a price per billing interval (with trials, setup fees,
 * tax); subscriptions instantiate a plan for a subscriber and a billing engine generates an invoice each
 * cycle, auto-collects (or leaves it for manual payment), advances the period, and duns overdue invoices.
 * Paid invoices post to the GL via the outbox. Tenant-scoped (RLS); money in integer minor units.
 *
 * Tables: sub_plan, subscription, sub_invoice, sub_gl_config (one per tenant), sub_doc_seq (numbering).
 */
export class Subscriptions1725100000000 implements MigrationInterface {
  name = 'Subscriptions1725100000000';

  public async up(q: QueryRunner): Promise<void> {
    const table = async (name: string, cols: string[]): Promise<void> => {
      await q.query(createTenantTableSql(name, cols));
      await q.query(`ALTER TABLE "${name}" ADD CONSTRAINT "uq_${name}_tenant_id" UNIQUE ("tenant_id","id")`);
      for (const stmt of enableTenantRlsSql(name)) await q.query(stmt);
      await q.query(grantAppUserSql(name));
    };

    await table('sub_plan', [
      '"name" text NOT NULL',
      '"code" text',
      '"description" text',
      `"currency" text NOT NULL DEFAULT 'PKR'`,
      '"amount_minor" bigint NOT NULL DEFAULT 0',
      '"tax_rate" integer NOT NULL DEFAULT 0',
      `"billing_interval" text NOT NULL DEFAULT 'MONTH'`,
      '"interval_count" integer NOT NULL DEFAULT 1',
      '"trial_days" integer NOT NULL DEFAULT 0',
      '"setup_fee_minor" bigint NOT NULL DEFAULT 0',
      `"status" text NOT NULL DEFAULT 'ACTIVE'`,
    ]);
    await q.query(`ALTER TABLE "sub_plan" ADD CONSTRAINT "ck_sub_plan_interval" CHECK ("billing_interval" IN ('DAY','WEEK','MONTH','YEAR'))`);
    await q.query(`ALTER TABLE "sub_plan" ADD CONSTRAINT "ck_sub_plan_status" CHECK ("status" IN ('ACTIVE','ARCHIVED'))`);
    await q.query(`CREATE UNIQUE INDEX "uq_sub_plan_code" ON "sub_plan" ("tenant_id", lower("code")) WHERE code IS NOT NULL AND deleted_at IS NULL`);

    await table('subscription', [
      '"subscription_no" text NOT NULL',
      '"plan_id" uuid NOT NULL',
      '"client_id" uuid',
      '"customer_name" text NOT NULL',
      '"customer_email" text NOT NULL',
      '"quantity" integer NOT NULL DEFAULT 1',
      `"collection_mode" text NOT NULL DEFAULT 'AUTO'`,
      `"status" text NOT NULL DEFAULT 'ACTIVE'`,
      '"amount_minor" bigint NOT NULL DEFAULT 0',
      '"tax_rate" integer NOT NULL DEFAULT 0',
      `"currency" text NOT NULL DEFAULT 'PKR'`,
      `"billing_interval" text NOT NULL DEFAULT 'MONTH'`,
      '"interval_count" integer NOT NULL DEFAULT 1',
      '"start_date" date NOT NULL DEFAULT current_date',
      '"current_period_start" timestamptz',
      '"current_period_end" timestamptz',
      '"trial_end" timestamptz',
      '"next_billing_at" timestamptz',
      '"cancel_at_period_end" boolean NOT NULL DEFAULT false',
      '"canceled_at" timestamptz',
      '"paused_at" timestamptz',
      '"failed_attempts" integer NOT NULL DEFAULT 0',
    ]);
    await q.query(`ALTER TABLE "subscription" ADD CONSTRAINT "ck_subscription_status" CHECK ("status" IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED','CANCELLED','EXPIRED'))`);
    await q.query(`ALTER TABLE "subscription" ADD CONSTRAINT "ck_subscription_mode" CHECK ("collection_mode" IN ('AUTO','MANUAL'))`);
    await q.query(`CREATE UNIQUE INDEX "uq_subscription_no" ON "subscription" ("tenant_id","subscription_no")`);
    await q.query(`CREATE INDEX "ix_subscription_status" ON "subscription" ("tenant_id","status")`);
    await q.query(`CREATE INDEX "ix_subscription_billing" ON "subscription" ("tenant_id","status","next_billing_at")`);
    await q.query(`CREATE INDEX "ix_subscription_email" ON "subscription" ("tenant_id", lower("customer_email"))`);

    await table('sub_invoice', [
      '"invoice_no" text NOT NULL',
      '"subscription_id" uuid NOT NULL',
      '"client_id" uuid',
      '"period_start" timestamptz',
      '"period_end" timestamptz',
      '"amount_minor" bigint NOT NULL DEFAULT 0',
      '"tax_minor" bigint NOT NULL DEFAULT 0',
      '"total_minor" bigint NOT NULL DEFAULT 0',
      `"currency" text NOT NULL DEFAULT 'PKR'`,
      `"status" text NOT NULL DEFAULT 'OPEN'`,
      '"due_date" timestamptz',
      '"issued_at" timestamptz NOT NULL DEFAULT now()',
      '"paid_at" timestamptz',
      '"attempt_count" integer NOT NULL DEFAULT 0',
      '"payment_ref" text',
    ]);
    await q.query(`ALTER TABLE "sub_invoice" ADD CONSTRAINT "ck_sub_invoice_status" CHECK ("status" IN ('OPEN','PAID','VOID','UNCOLLECTIBLE'))`);
    await q.query(`ALTER TABLE "sub_invoice" ADD CONSTRAINT "fk_sub_invoice_subscription"
      FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "subscription"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE UNIQUE INDEX "uq_sub_invoice_no" ON "sub_invoice" ("tenant_id","invoice_no")`);
    await q.query(`CREATE INDEX "ix_sub_invoice_subscription" ON "sub_invoice" ("tenant_id","subscription_id")`);
    await q.query(`CREATE INDEX "ix_sub_invoice_due" ON "sub_invoice" ("tenant_id","status","due_date")`);

    await table('sub_gl_config', [
      '"clearing_account_id" uuid',
      '"revenue_account_id" uuid',
      '"tax_account_id" uuid',
    ]);
    await q.query(`CREATE UNIQUE INDEX "uq_sub_gl_config_tenant" ON "sub_gl_config" ("tenant_id")`);

    await table('sub_doc_seq', ['"doc_type" text NOT NULL', '"last_no" bigint NOT NULL DEFAULT 0']);
    await q.query(`CREATE UNIQUE INDEX "uq_sub_doc_seq" ON "sub_doc_seq" ("tenant_id","doc_type")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['sub_doc_seq', 'sub_gl_config', 'sub_invoice', 'subscription', 'sub_plan']) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
