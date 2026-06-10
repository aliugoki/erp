import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Transactional outbox (ADR-004). Domain events are written here in the SAME DB transaction as the
 * business change; a relay (Phase 4) polls unpublished rows and publishes them. Tenant-scoped (RLS).
 * `published_at IS NULL` marks pending rows — indexed for the relay's poll.
 */
export class Outbox1718700000000 implements MigrationInterface {
  name = 'Outbox1718700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "outbox_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0
      )
    `);
    // Partial index: the relay only scans pending rows, oldest first.
    await q.query(
      `CREATE INDEX "ix_outbox_pending" ON "outbox_event" ("occurred_at") WHERE "published_at" IS NULL`,
    );
    for (const stmt of enableTenantRlsSql('outbox_event')) await q.query(stmt);
    await q.query(grantAppUserSql('outbox_event'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "outbox_event"`);
  }
}
