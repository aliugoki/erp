import { Injectable } from '@nestjs/common';
import type { Publisher, OutboxEvent } from '../outbox/relay/publisher';
import { EventBusService } from './event-bus.service';

/** The relay's Publisher backed by the RabbitMQ EventBus — adapts an outbox row to a BaseEvent. */
@Injectable()
export class RabbitMqPublisher implements Publisher {
  constructor(private readonly bus: EventBusService) {}

  async publish(event: OutboxEvent): Promise<void> {
    await this.bus.publish({
      id: event.id,
      type: event.type,
      tenantId: event.tenantId,
      occurredAt:
        event.occurredAt instanceof Date ? event.occurredAt.toISOString() : String(event.occurredAt),
      payload: event.payload,
    });
  }
}
