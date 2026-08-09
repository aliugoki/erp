import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_TYPES } from '@metaxperts/shared';
import { EventBusService } from '../eventbus/event-bus.service';
import { RealtimeGateway } from './realtime.gateway';

/** Domain events bridged to realtime clients — new invoice, low-stock alert, deal stage change. */
const BRIDGED_TYPES = [
  EVENT_TYPES.FINANCE_INVOICE_PAID,
  EVENT_TYPES.INVENTORY_LOW_STOCK,
  EVENT_TYPES.CRM_DEAL_CLOSED,
  EVENT_TYPES.CRM_LEAD_CONVERTED,
  EVENT_TYPES.HR_LEAVE_APPROVED,
  EVENT_TYPES.HR_PAYROLL_RUN_COMPLETED,
  EVENT_TYPES.PRODUCTION_ORDER_COMPLETED,
  // Restaurant live updates → waiter tablets, KDS screens, customer QR pages (ADR-011).
  EVENT_TYPES.RESTAURANT_ORDER_PLACED,
  EVENT_TYPES.RESTAURANT_ORDER_CONFIRMED,
  EVENT_TYPES.RESTAURANT_KDS_TICKET_READY,
  EVENT_TYPES.RESTAURANT_ORDER_SERVED,
  EVENT_TYPES.RESTAURANT_BILL_SETTLED,
  EVENT_TYPES.RESTAURANT_DELIVERY_ASSIGNED,
  EVENT_TYPES.RESTAURANT_DELIVERY_COMPLETED,
  EVENT_TYPES.RESTAURANT_RESERVATION_CREATED,
];

/**
 * Feeds the realtime gateway from domain events (Chunk 5.3) — never from direct business coupling.
 * Subscribes to each bridged event on its own EXCLUSIVE, auto-deleted queue (per process instance), so
 * every API instance receives every event and emits it to its locally-connected tenant rooms. The
 * event already carries `tenantId`, so emits stay tenant-scoped. Best-effort: a broker outage degrades
 * realtime without taking the API (or the gateway) down.
 */
@Injectable()
export class RealtimeBridge implements OnApplicationBootstrap {
  private readonly logger = new Logger(RealtimeBridge.name);

  constructor(
    private readonly bus: EventBusService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const instance = randomUUID().slice(0, 8);
    for (const type of BRIDGED_TYPES) {
      try {
        await this.bus.subscribe(
          type,
          (event) => this.gateway.emitToTenant(event.tenantId, event.type, event.payload),
          { queue: `realtime.${type}.${instance}`, durable: false, autoDelete: true, exclusive: true },
        );
      } catch (err) {
        this.logger.warn(`realtime bridge failed to subscribe to ${type}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Realtime bridge subscribed (${BRIDGED_TYPES.length} event types, instance ${instance})`);
  }
}
