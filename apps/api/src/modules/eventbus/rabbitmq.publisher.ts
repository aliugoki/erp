import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@metaxperts/config';
import { CircuitBreaker, withTimeout } from '../../common/resilience';
import type { Publisher, OutboxEvent } from '../outbox/relay/publisher';
import { EventBusService } from './event-bus.service';

/**
 * The relay's Publisher backed by the RabbitMQ EventBus — adapts an outbox row to a BaseEvent. Phase
 * 7.1: every publish is bounded by a TIMEOUT and guarded by a CIRCUIT BREAKER, so a down/slow broker
 * fails fast (the relay then just leaves the row pending and retries the batch later) instead of
 * blocking the relay loop. When the broker recovers the breaker half-opens and closes on success.
 */
@Injectable()
export class RabbitMqPublisher implements Publisher {
  private readonly logger = new Logger(RabbitMqPublisher.name);
  private readonly breaker: CircuitBreaker;
  private readonly timeoutMs: number;

  constructor(
    private readonly bus: EventBusService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.timeoutMs = config.get('BROKER_PUBLISH_TIMEOUT_MS', { infer: true });
    this.breaker = new CircuitBreaker({
      name: 'broker',
      threshold: config.get('BROKER_BREAKER_THRESHOLD', { infer: true }),
      cooldownMs: config.get('BROKER_BREAKER_COOLDOWN_MS', { infer: true }),
    });
  }

  async publish(event: OutboxEvent): Promise<void> {
    await this.breaker.exec(() =>
      withTimeout(
        () =>
          this.bus.publish({
            id: event.id,
            type: event.type,
            tenantId: event.tenantId,
            occurredAt:
              event.occurredAt instanceof Date ? event.occurredAt.toISOString() : String(event.occurredAt),
            payload: event.payload,
          }),
        this.timeoutMs,
        'broker.publish',
      ),
    );
  }
}
