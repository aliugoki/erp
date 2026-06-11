import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, domainOf } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { EventBusService } from '../eventbus/event-bus.service';
import { type DlqEntry, DlqService } from './dlq.service';

export type EventHandler = (event: BaseEvent, manager: EntityManager) => Promise<void>;

export interface ConsumerOptions {
  /** Event type to consume, e.g. 'finance.invoice_paid.v1'. */
  eventType: string;
  /** Stable consumer name — dedupe + queue names key off this. */
  consumer: string;
  handler: EventHandler;
  /** Attempts before parking in the DLQ (default 3). */
  maxAttempts?: number;
  /** Base backoff in ms; delay = base * 2^attempt + jitter (default 100). */
  baseDelayMs?: number;
  /** Channel prefetch / concurrency cap (default 10). */
  prefetch?: number;
}

function backoff(base: number, attempt: number): number {
  const jitter = Math.floor((attempt + 1) * 0.25 * base);
  return base * 2 ** attempt + jitter;
}

/**
 * Reliable event consumption (ADR-004):
 *  - **Idempotent**: the handler effect + a `processed_event` row commit in one transaction; a
 *    redelivered event hits the unique (consumer, event_id) and is skipped.
 *  - **Retry with backoff**: a failing handler re-publishes the message to a per-consumer retry queue
 *    with a per-message TTL (exponential backoff + jitter); it dead-letters back to the main queue.
 *  - **DLQ**: after maxAttempts (or on a poison/malformed message) the event is parked in `dlq_event`.
 */
@Injectable()
export class IdempotentConsumer {
  private readonly logger = new Logger(IdempotentConsumer.name);

  constructor(
    private readonly bus: EventBusService,
    private readonly tenantTx: TenantTransactionService,
    private readonly dlq: DlqService,
  ) {}

  /** Apply a handler exactly once for an event id (dedupe via processed_event). */
  async handleOnce(consumer: string, event: BaseEvent, handler: EventHandler): Promise<'processed' | 'duplicate'> {
    return this.tenantTx.runFor(event.tenantId, async (m) => {
      const inserted = (await m.query(
        `INSERT INTO processed_event (tenant_id, consumer, event_id)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2)
         ON CONFLICT (consumer, event_id) DO NOTHING RETURNING id`,
        [consumer, event.id],
      )) as unknown[];
      if (inserted.length === 0) return 'duplicate';
      await handler(event, m);
      return 'processed';
    });
  }

  /**
   * Park a message in the DLQ, swallowing any failure. The DLQ insert can itself fail on a truly
   * poison message (e.g. a non-uuid tenant id from a stray/foreign publisher); a failed park must NOT
   * crash the consumer — we log and drop, so the queue can't wedge on one bad message.
   */
  private async safePark(consumer: string, tenantId: string, entry: DlqEntry): Promise<void> {
    try {
      await this.dlq.park(tenantId, entry);
    } catch (err) {
      this.logger.error(`DLQ park failed for "${consumer}" (tenant=${tenantId}); dropping message: ${(err as Error).message}`);
    }
  }

  /** Subscribe a consumer with the full idempotency + retry + DLQ machinery. */
  async register(opts: ConsumerOptions): Promise<void> {
    const { eventType, consumer, handler, maxAttempts = 3, baseDelayMs = 100, prefetch = 10 } = opts;
    const ch = await this.bus.getChannel();
    const domain = domainOf(eventType);
    const mainQ = `c.${consumer}`;
    const retryEx = `c.${consumer}.retry`;
    const retryQ = `c.${consumer}.retry.q`;
    const backEx = `c.${consumer}.back`;

    await ch.assertExchange(domain, 'topic', { durable: true });
    await ch.assertExchange(retryEx, 'direct', { durable: true });
    await ch.assertExchange(backEx, 'direct', { durable: true });
    // Retried messages wait in retryQ (per-message TTL) then dead-letter back to the main queue.
    await ch.assertQueue(retryQ, { durable: true, deadLetterExchange: backEx, deadLetterRoutingKey: 'b' });
    await ch.bindQueue(retryQ, retryEx, 'r');
    await ch.assertQueue(mainQ, { durable: true });
    await ch.bindQueue(mainQ, domain, eventType); // normal delivery
    await ch.bindQueue(mainQ, backEx, 'b'); // retried delivery
    await ch.prefetch(prefetch);

    await ch.consume(mainQ, (msg) => {
      if (!msg) return;
      const attempt = Number(msg.properties.headers?.['x-retry'] ?? 0);
      const headerTenant = msg.properties.headers?.tenantId as string | undefined;

      let event: BaseEvent;
      try {
        event = JSON.parse(msg.content.toString()) as BaseEvent;
      } catch {
        // Poison: cannot be parsed -> park immediately, never loop.
        const tenant = headerTenant;
        const raw = msg.content.toString();
        if (tenant) {
          void this.safePark(consumer, tenant, { consumer, eventId: null, eventType, payload: raw, originalEvent: raw, reason: 'malformed payload', attempts: attempt }).finally(() => ch.ack(msg));
        } else {
          this.logger.warn('dropping poison message with no tenant header');
          ch.ack(msg);
        }
        return;
      }

      void this.handleOnce(consumer, event, handler)
        .then(() => ch.ack(msg))
        .catch((err) => {
          const next = attempt + 1;
          if (next >= maxAttempts) {
            void this.safePark(consumer, event.tenantId, {
              consumer,
              eventId: event.id,
              eventType: event.type,
              payload: event.payload,
              originalEvent: event,
              reason: (err as Error).message,
              attempts: next,
            }).finally(() => ch.ack(msg));
          } else {
            ch.publish(retryEx, 'r', msg.content, {
              persistent: true,
              expiration: String(backoff(baseDelayMs, attempt)),
              headers: { ...msg.properties.headers, 'x-retry': next, tenantId: event.tenantId },
            });
            ch.ack(msg);
          }
        });
    });

    this.logger.log(`consumer "${consumer}" subscribed to ${eventType} (maxAttempts=${maxAttempts})`);
  }
}
