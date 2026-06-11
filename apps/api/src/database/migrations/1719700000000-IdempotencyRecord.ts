import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Idempotency records (Chunk 7.2). For unsafe POSTs carrying an `Idempotency-Key`, the first request
 * claims a row (unique per tenant+key) and, on success, stores its status + response; a duplicate with
 * the same key REPLAYS that stored response without re-running the handler — so a client retry yields
 * one effect and an identical response. Tenant-scoped (RLS). `request_hash` guards against a key being
 * reused for a different request body.
 */
export class IdempotencyRecord1719700000000 implements MigrationInterface {
  name = 'IdempotencyRecord1719700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('idempotency_record', [
        '"key" text NOT NULL',
        '"request_hash" text NOT NULL',
        '"status_code" integer',
        '"response_body" jsonb',
        '"completed" boolean NOT NULL DEFAULT false',
      ]),
    );
    await q.query(`CREATE UNIQUE INDEX "uq_idempotency_record" ON "idempotency_record" ("tenant_id", "key")`);
    // For a future TTL sweep of old keys.
    await q.query(`CREATE INDEX "ix_idempotency_record_created" ON "idempotency_record" ("created_at")`);

    for (const stmt of enableTenantRlsSql('idempotency_record')) await q.query(stmt);
    await q.query(grantAppUserSql('idempotency_record'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "idempotency_record" CASCADE`);
  }
}
