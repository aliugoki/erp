import { Injectable, Logger } from '@nestjs/common';

/** A domain event as read from the outbox, handed to a Publisher. */
export interface OutboxEvent {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  occurredAt: Date | string;
}

/** Where the relay sends published events. The real RabbitMQ implementation lands in Chunk 4.2. */
export interface Publisher {
  publish(event: OutboxEvent): Promise<void>;
}

export const PUBLISHER = Symbol('PUBLISHER');

/** Default publisher: logs the event. Swapped for the RabbitMQ EventBus publisher in Chunk 4.2. */
@Injectable()
export class LoggingPublisher implements Publisher {
  private readonly logger = new Logger('OutboxPublisher');

  publish(event: OutboxEvent): Promise<void> {
    this.logger.log(`publish ${event.type} (${event.id}) tenant=${event.tenantId}`);
    return Promise.resolve();
  }
}
