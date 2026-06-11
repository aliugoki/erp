import { Injectable } from '@nestjs/common';
import { context, propagation } from '@opentelemetry/api';
import type { EntityManager } from 'typeorm';

/**
 * Writes domain events to the transactional outbox (ADR-004). ALWAYS call `write` with the
 * EntityManager of the transaction that performs the business change, so the event row commits
 * atomically with it — never publish inline. The relay (Phase 4) handles delivery. The tenant_id is
 * taken from the transaction's `app.tenant_id` GUC, so the event is tenant-scoped like its source.
 *
 * Phase 8.1: the active trace context's `traceparent` is captured into the row so the relay can
 * restore it at publish time — keeping one connected trace across the async outbox boundary.
 */
@Injectable()
export class OutboxService {
  async write(manager: EntityManager, type: string, payload: unknown): Promise<void> {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier); // adds `traceparent` when a span is active
    await manager.query(
      `INSERT INTO outbox_event (tenant_id, type, payload, trace_context)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2::jsonb, $3)`,
      [type, JSON.stringify(payload), carrier.traceparent ?? null],
    );
  }
}
