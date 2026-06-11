import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Carry the W3C trace context through the transactional outbox (Chunk 8.1). The outbox decouples the
 * request from delivery, which normally breaks trace continuity. Storing the `traceparent` at write
 * time and restoring it when the relay publishes makes a single user action one connected trace:
 * HTTP request → (outbox) → relay publish → broker → consumer → ML.
 */
export class OutboxTraceContext1719900000000 implements MigrationInterface {
  name = 'OutboxTraceContext1719900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "outbox_event" ADD COLUMN IF NOT EXISTS "trace_context" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "outbox_event" DROP COLUMN IF EXISTS "trace_context"`);
  }
}
