import { Injectable, NotFoundException } from '@nestjs/common';
import type { BaseEvent } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { EventBusService } from '../eventbus/event-bus.service';

export interface DlqEntry {
  consumer: string;
  eventId: string | null;
  eventType: string;
  payload: unknown;
  originalEvent: unknown;
  reason: string;
  attempts: number;
}

/** The dead-letter parking lot (DB-backed). Inspectable + requeuable per tenant via /admin/dlq. */
@Injectable()
export class DlqService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly bus: EventBusService,
  ) {}

  /** Park a failed/poison message (written in the event's tenant context). */
  async park(tenantId: string, entry: DlqEntry): Promise<void> {
    await this.tenantTx.runFor(tenantId, (m) =>
      m.query(
        `INSERT INTO dlq_event (tenant_id, consumer, event_id, event_type, payload, original_event, reason, attempts)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          entry.consumer,
          entry.eventId,
          entry.eventType,
          JSON.stringify(entry.payload ?? null),
          JSON.stringify(entry.originalEvent),
          entry.reason,
          entry.attempts,
        ],
      ),
    );
  }

  /** List the current tenant's dead-lettered events (RLS-scoped). */
  async list() {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT id, consumer, event_id, event_type, reason, attempts, failed_at
         FROM dlq_event ORDER BY failed_at DESC LIMIT 200`,
      ),
    );
  }

  /** Republish a dead-lettered event back onto the bus and remove it from the DLQ. */
  async requeue(id: string): Promise<void> {
    const rows = (await this.tenantTx.run((m) =>
      m.query(`SELECT id, original_event FROM dlq_event WHERE id = $1`, [id]),
    )) as Array<{ id: string; original_event: BaseEvent }>;
    if (!rows[0]) throw new NotFoundException('DLQ entry not found');

    await this.bus.publish(rows[0].original_event);
    await this.tenantTx.run((m) => m.query(`DELETE FROM dlq_event WHERE id = $1`, [id]));
  }
}
