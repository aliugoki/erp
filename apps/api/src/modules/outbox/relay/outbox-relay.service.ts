import { Inject, Injectable, Logger } from '@nestjs/common';
import { ROOT_CONTEXT, context, propagation } from '@opentelemetry/api';
import type { DataSource } from 'typeorm';
import { type OutboxEvent, PUBLISHER, type Publisher } from './publisher';

/** DI token for the relay's privileged DataSource (owner connection — bypasses RLS to see ALL
 * tenants' pending events; the app role is RLS-restricted). */
export const RELAY_DATA_SOURCE = Symbol('RELAY_DATA_SOURCE');

export interface BatchResult {
  scanned: number;
  published: number;
  failed: number;
}

interface OutboxRow {
  id: string;
  tenant_id: string;
  type: string;
  payload: unknown;
  occurred_at: Date;
  trace_context: string | null;
}

/**
 * Transactional-outbox relay (ADR-004). Polls unpublished rows with `FOR UPDATE SKIP LOCKED` so
 * concurrent relays never grab the same row, publishes each, and stamps `published_at` only after a
 * successful publish. Crash safety: if the process dies before the batch transaction commits, nothing
 * is marked — the rows are simply re-published next run (at-least-once; consumers dedupe by event id
 * in Chunk 4.3). A row is never marked published twice.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  constructor(
    @Inject(RELAY_DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(PUBLISHER) private readonly publisher: Publisher,
  ) {}

  /** Process up to `limit` pending events in a single transaction. Returns counts. */
  async processBatch(limit = 100): Promise<BatchResult> {
    return this.dataSource.transaction(async (m) => {
      const rows = (await m.query(
        `SELECT id, tenant_id, type, payload, occurred_at, trace_context
         FROM outbox_event
         WHERE published_at IS NULL
         ORDER BY occurred_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [limit],
      )) as OutboxRow[];

      let published = 0;
      let failed = 0;
      for (const row of rows) {
        const event: OutboxEvent = {
          id: row.id,
          tenantId: row.tenant_id,
          type: row.type,
          payload: row.payload,
          occurredAt: row.occurred_at,
        };
        // Restore the originating request's trace context (Phase 8.1) so the publish span — and the
        // downstream consume span (amqplib propagates it in the message headers) — join one trace.
        const ctx = row.trace_context
          ? propagation.extract(ROOT_CONTEXT, { traceparent: row.trace_context })
          : context.active();
        try {
          await context.with(ctx, () => this.publisher.publish(event));
          await m.query(`UPDATE outbox_event SET published_at = now() WHERE id = $1`, [row.id]);
          published++;
        } catch (err) {
          // Leave published_at NULL so it retries; record the attempt. One bad event doesn't block
          // the rest of the batch.
          await m.query(`UPDATE outbox_event SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
          failed++;
          this.logger.warn(`publish failed for ${row.type} (${row.id}): ${(err as Error).message}`);
        }
      }
      return { scanned: rows.length, published, failed };
    });
  }

  /** Drain all currently-pending events (used by tests / on-demand flushes). */
  async drain(batchSize = 100): Promise<BatchResult> {
    const totals: BatchResult = { scanned: 0, published: 0, failed: 0 };
    for (;;) {
      const r = await this.processBatch(batchSize);
      totals.scanned += r.scanned;
      totals.published += r.published;
      totals.failed += r.failed;
      // Stop when a pass neither published nor found new work (avoids spinning on persistently
      // failing rows).
      if (r.scanned === 0 || r.published === 0) break;
    }
    return totals;
  }
}
