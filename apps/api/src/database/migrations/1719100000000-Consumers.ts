import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Consumer-side reliability tables (Chunk 4.3, ADR-004).
 * - processed_event: dedupe by (consumer, event_id) so redelivery is idempotent — the consumer
 *   inserts this in the SAME transaction as its effect; a conflict means "already handled".
 * - dlq_event: the dead-letter parking lot (DB-backed, so it's inspectable/requeuable per tenant).
 * Both tenant-scoped (RLS).
 */
export class Consumers1719100000000 implements MigrationInterface {
  name = 'Consumers1719100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "processed_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "consumer" text NOT NULL,
        "event_id" uuid NOT NULL,
        "processed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX "uq_processed_event" ON "processed_event" ("consumer", "event_id")`,
    );
    for (const stmt of enableTenantRlsSql('processed_event')) await q.query(stmt);
    await q.query(grantAppUserSql('processed_event'));

    await q.query(`
      CREATE TABLE IF NOT EXISTS "dlq_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "consumer" text NOT NULL,
        "event_id" uuid,
        "event_type" text NOT NULL,
        "payload" jsonb,
        "original_event" jsonb NOT NULL,
        "reason" text NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "failed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX "ix_dlq_event_tenant" ON "dlq_event" ("tenant_id", "failed_at" DESC)`);
    for (const stmt of enableTenantRlsSql('dlq_event')) await q.query(stmt);
    await q.query(grantAppUserSql('dlq_event'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "dlq_event"`);
    await q.query(`DROP TABLE IF EXISTS "processed_event"`);
  }
}
