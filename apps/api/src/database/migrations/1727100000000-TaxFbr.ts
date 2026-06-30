import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, disableTenantRlsSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Tax & compliance — FBR (Federal Board of Revenue, Pakistan) digital-invoicing integration.
 * `fbr_config` holds the per-tenant seller registration + API credentials (one row/tenant).
 * `fbr_invoice` is the report ledger: each source invoice/sale reported to FBR, with the returned
 * FBR invoice number + QR payload and a status. Tenant-scoped + RLS. Built to extend to other tax
 * authorities later (FBR first). Idempotent.
 */
export class TaxFbr1727100000000 implements MigrationInterface {
  name = 'TaxFbr1727100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('fbr_config', [
        `"seller_ntn" text NOT NULL DEFAULT ''`,
        `"seller_name" text NOT NULL DEFAULT ''`,
        `"pos_id" text NOT NULL DEFAULT ''`,
        `"environment" text NOT NULL DEFAULT 'sandbox'`,
        `"api_token" text`,
        `"enabled" boolean NOT NULL DEFAULT false`,
      ]),
    );
    await q.query(`ALTER TABLE "fbr_config" ADD CONSTRAINT "uq_fbr_config_tenant" UNIQUE ("tenant_id")`);
    for (const stmt of enableTenantRlsSql('fbr_config')) await q.query(stmt);
    await q.query(grantAppUserSql('fbr_config'));

    await q.query(
      createTenantTableSql('fbr_invoice', [
        `"source_type" text NOT NULL DEFAULT 'pos_sale'`,
        '"source_id" uuid NOT NULL',
        `"invoice_ref" text NOT NULL DEFAULT ''`,
        '"fbr_invoice_number" text',
        '"qr" text',
        `"status" text NOT NULL DEFAULT 'PENDING'`,
        '"environment" text',
        '"amount_minor" bigint NOT NULL DEFAULT 0',
        '"payload" jsonb',
        '"response" jsonb',
        '"error" text',
        '"reported_at" timestamptz',
      ]),
    );
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_fbr_invoice_tenant_created" ON "fbr_invoice" ("tenant_id","created_at" DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_fbr_invoice_source" ON "fbr_invoice" ("tenant_id","source_type","source_id")`);
    for (const stmt of enableTenantRlsSql('fbr_invoice')) await q.query(stmt);
    await q.query(grantAppUserSql('fbr_invoice'));
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const stmt of disableTenantRlsSql('fbr_invoice')) await q.query(stmt);
    await q.query(`DROP TABLE IF EXISTS "fbr_invoice"`);
    for (const stmt of disableTenantRlsSql('fbr_config')) await q.query(stmt);
    await q.query(`DROP TABLE IF EXISTS "fbr_config"`);
  }
}
