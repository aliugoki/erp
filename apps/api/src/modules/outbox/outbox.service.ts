import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Writes domain events to the transactional outbox (ADR-004). ALWAYS call `write` with the
 * EntityManager of the transaction that performs the business change, so the event row commits
 * atomically with it — never publish inline. The relay (Phase 4) handles delivery. The tenant_id is
 * taken from the transaction's `app.tenant_id` GUC, so the event is tenant-scoped like its source.
 */
@Injectable()
export class OutboxService {
  async write(manager: EntityManager, type: string, payload: unknown): Promise<void> {
    await manager.query(
      `INSERT INTO outbox_event (tenant_id, type, payload)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2::jsonb)`,
      [type, JSON.stringify(payload)],
    );
  }
}
