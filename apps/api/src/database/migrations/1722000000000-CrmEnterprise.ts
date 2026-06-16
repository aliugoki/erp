import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Enterprise CRM: turns the minimal clients/contacts/deals model into a full sales suite.
 *
 * - Accounts: `crm_client` gains org metadata (phone/email/address/owner/annual revenue) and a numbered
 *   `account_no` so a client reads as a proper account.
 * - Opportunities: `crm_deal` gains `probability` (weighted forecast = value × probability), an `owner_id`,
 *   a `source`, the originating `lead_id`, and close/loss tracking (`closed_at`, `lost_reason`).
 * - Leads: `crm_lead` — capture + qualification funnel (NEW→CONTACTED→QUALIFIED→UNQUALIFIED→CONVERTED),
 *   numbered LEAD-####, with one-click conversion recording `converted_client_id`/`converted_deal_id`.
 * - Activities: `crm_activity` — the timeline (CALL/MEETING/EMAIL/TASK/NOTE), each optionally linked to an
 *   account/contact/deal/lead, with due + completion so tasks can be chased and overdue ones surfaced.
 *
 * Document numbers come from `crm_doc_seq` (per-tenant, per-type counter), mirroring inventory_doc_seq.
 * Money is bigint minor units; FKs are composite (tenant_id, id); RLS on every table. Idempotent: column
 * adds use IF NOT EXISTS; table creates run once via the migration ledger.
 */
export class CrmEnterprise1722000000000 implements MigrationInterface {
  name = 'CrmEnterprise1722000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Per-tenant, per-doc-type running counter (LEAD/…) ───────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "crm_doc_seq" (
        "tenant_id" uuid NOT NULL,
        "doc_type" text NOT NULL,
        "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id", "doc_type")
      )
    `);
    for (const stmt of enableTenantRlsSql('crm_doc_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('crm_doc_seq'));

    // ── Accounts: enrich crm_client ─────────────────────────────────────────────
    for (const col of [
      '"phone" text',
      '"email" text',
      '"address" text',
      '"city" text',
      '"country" text',
      '"owner_id" uuid',
      '"annual_revenue_minor" bigint NOT NULL DEFAULT 0',
      '"account_no" text',
    ]) {
      await q.query(`ALTER TABLE "crm_client" ADD COLUMN IF NOT EXISTS ${col}`);
    }

    // ── Opportunities: enrich crm_deal ──────────────────────────────────────────
    for (const col of [
      '"probability" integer NOT NULL DEFAULT 10',
      '"owner_id" uuid',
      '"source" text',
      '"lead_id" uuid',
      '"closed_at" timestamptz',
      '"lost_reason" text',
    ]) {
      await q.query(`ALTER TABLE "crm_deal" ADD COLUMN IF NOT EXISTS ${col}`);
    }
    await q.query(
      `ALTER TABLE "crm_deal" DROP CONSTRAINT IF EXISTS "ck_crm_deal_probability"`,
    );
    await q.query(
      `ALTER TABLE "crm_deal" ADD CONSTRAINT "ck_crm_deal_probability" CHECK ("probability" BETWEEN 0 AND 100)`,
    );

    // ── Leads ───────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('crm_lead', [
        '"lead_no" text NOT NULL',
        '"name" text NOT NULL',
        '"company" text',
        '"email" text',
        '"phone" text',
        '"source" text',
        `"status" text NOT NULL DEFAULT 'NEW'`,
        `"rating" text NOT NULL DEFAULT 'WARM'`,
        '"est_value_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        '"owner_id" uuid',
        '"notes" text',
        '"converted_client_id" uuid',
        '"converted_deal_id" uuid',
        '"converted_at" timestamptz',
      ]),
    );
    await q.query(`ALTER TABLE "crm_lead" ADD CONSTRAINT "uq_crm_lead_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(
      `ALTER TABLE "crm_lead" ADD CONSTRAINT "ck_crm_lead_status" CHECK ("status" IN ('NEW','CONTACTED','QUALIFIED','UNQUALIFIED','CONVERTED'))`,
    );
    await q.query(
      `ALTER TABLE "crm_lead" ADD CONSTRAINT "ck_crm_lead_rating" CHECK ("rating" IN ('HOT','WARM','COLD'))`,
    );
    await q.query(`CREATE INDEX "ix_crm_lead_status" ON "crm_lead" ("tenant_id","status")`);

    // ── Activities / tasks timeline ─────────────────────────────────────────────
    await q.query(
      createTenantTableSql('crm_activity', [
        `"type" text NOT NULL`,
        '"subject" text NOT NULL',
        '"body" text',
        '"due_at" timestamptz',
        '"completed" boolean NOT NULL DEFAULT false',
        '"completed_at" timestamptz',
        '"client_id" uuid',
        '"contact_id" uuid',
        '"deal_id" uuid',
        '"lead_id" uuid',
        '"owner_id" uuid',
        '"outcome" text',
      ]),
    );
    await q.query(`ALTER TABLE "crm_activity" ADD CONSTRAINT "uq_crm_activity_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(
      `ALTER TABLE "crm_activity" ADD CONSTRAINT "ck_crm_activity_type" CHECK ("type" IN ('CALL','MEETING','EMAIL','TASK','NOTE'))`,
    );
    await q.query(`CREATE INDEX "ix_crm_activity_deal" ON "crm_activity" ("tenant_id","deal_id")`);
    await q.query(`CREATE INDEX "ix_crm_activity_client" ON "crm_activity" ("tenant_id","client_id")`);
    await q.query(`CREATE INDEX "ix_crm_activity_lead" ON "crm_activity" ("tenant_id","lead_id")`);
    await q.query(`CREATE INDEX "ix_crm_activity_open" ON "crm_activity" ("tenant_id","due_at") WHERE "completed" = false`);
    // Linked account FK (tenant-safe); the other links are soft (no FK) so an activity can attach to a
    // lead/contact/deal without coupling lifecycles.
    await q.query(
      `ALTER TABLE "crm_activity" ADD CONSTRAINT "fk_crm_activity_client"
       FOREIGN KEY ("tenant_id","client_id") REFERENCES "crm_client"("tenant_id","id") ON DELETE CASCADE`,
    );

    for (const table of ['crm_lead', 'crm_activity']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "crm_activity" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "crm_lead" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "crm_doc_seq" CASCADE`);
    await q.query(`ALTER TABLE "crm_deal" DROP CONSTRAINT IF EXISTS "ck_crm_deal_probability"`);
    for (const col of ['probability', 'owner_id', 'source', 'lead_id', 'closed_at', 'lost_reason']) {
      await q.query(`ALTER TABLE "crm_deal" DROP COLUMN IF EXISTS "${col}"`);
    }
    for (const col of ['phone', 'email', 'address', 'city', 'country', 'owner_id', 'annual_revenue_minor', 'account_no']) {
      await q.query(`ALTER TABLE "crm_client" DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
