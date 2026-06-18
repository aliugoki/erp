import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Real card-payment flow for the online store: a payment SESSION is created at checkout and confirmed
 * asynchronously (a hosted-gateway callback / webhook), instead of optimistically marking the order
 * paid. Pluggable per tenant via `ec_payment_config` — a built-in `SIMULATED` provider (self-hosted, no
 * external dependency) is the default; an `HTTP` provider forwards to any configured gateway and
 * verifies a signed webhook. No paid/closed SDK is bundled (ADR / open-source-only constraint).
 */
export class EcommercePayments1724400000000 implements MigrationInterface {
  name = 'EcommercePayments1724400000000';

  public async up(q: QueryRunner): Promise<void> {
    // Per-tenant payment provider configuration (one row per tenant).
    await q.query(
      createTenantTableSql('ec_payment_config', [
        `"provider" text NOT NULL DEFAULT 'SIMULATED'`,
        '"gateway_url" text',
        '"webhook_secret" text',
        '"publishable_key" text',
        '"enabled" boolean NOT NULL DEFAULT true',
      ]),
    );
    await q.query(`ALTER TABLE "ec_payment_config" ADD CONSTRAINT "ck_ec_payment_provider" CHECK ("provider" IN ('SIMULATED','HTTP'))`);
    await q.query(`CREATE UNIQUE INDEX "uq_ec_payment_config_tenant" ON "ec_payment_config" ("tenant_id")`);
    for (const stmt of enableTenantRlsSql('ec_payment_config')) await q.query(stmt);
    await q.query(grantAppUserSql('ec_payment_config'));

    // A payment session for an order.
    await q.query(
      createTenantTableSql('ec_payment', [
        '"order_id" uuid NOT NULL',
        '"provider" text NOT NULL',
        `"status" text NOT NULL DEFAULT 'PENDING'`,
        '"amount_minor" bigint NOT NULL',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"client_secret" text NOT NULL',
        '"provider_ref" text',
        '"paid_at" timestamptz',
      ]),
    );
    await q.query(`ALTER TABLE "ec_payment" ADD CONSTRAINT "uq_ec_payment_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`ALTER TABLE "ec_payment" ADD CONSTRAINT "ck_ec_payment_status" CHECK ("status" IN ('PENDING','PAID','FAILED','CANCELLED'))`);
    await q.query(`ALTER TABLE "ec_payment" ADD CONSTRAINT "fk_ec_payment_order"
      FOREIGN KEY ("tenant_id","order_id") REFERENCES "ec_order"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE INDEX "ix_ec_payment_order" ON "ec_payment" ("tenant_id","order_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ec_payment" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "ec_payment_config" CASCADE`);
  }
}
