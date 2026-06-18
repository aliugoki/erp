import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import {
  type BaseEvent,
  type EcommerceOrderPlacedV1,
  type EcommerceOrderStatusChangedV1,
  EVENT_TYPES,
} from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { EcommerceService } from './ecommerce.service';
import { customerOrderEmail } from './ecommerce.util';

/**
 * Customer transactional emails for the online store. On `ecommerce.order_placed` sends an order
 * confirmation; on `ecommerce.order_status_changed` sends a status update (paid / preparing / shipped /
 * cancelled / refunded). Reads the order inside the consumer's idempotent tenant transaction, builds a
 * plain-text email, and hands it to the (best-effort, retrying) email queue — so a buyer is emailed
 * exactly once per event. Gated by `NOTIFICATIONS_ENABLED`; actual delivery additionally needs
 * `NOTIFICATIONS_EMAIL_ENABLED` (the queue no-ops otherwise).
 */
@Injectable()
export class EcommerceEmailConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(EcommerceEmailConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly ec: EcommerceService,
    private readonly email: EmailQueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('NOTIFICATIONS_ENABLED', { infer: true })) {
      this.logger.log('Ecommerce customer emails disabled (NOTIFICATIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.ECOMMERCE_ORDER_PLACED,
      consumer: 'ecommerce-email-placed',
      handler: (event, m) => this.onOrderEvent(event, m, 'placed'),
    });
    await this.consumer.register({
      eventType: EVENT_TYPES.ECOMMERCE_ORDER_STATUS_CHANGED,
      consumer: 'ecommerce-email-status',
      handler: (event, m) => this.onOrderEvent(event, m, null),
    });
    this.logger.log('Ecommerce customer-email consumer registered (order placed + status changed)');
  }

  /** Shared handler: `kind='placed'` for confirmations; otherwise the new status from the event. */
  async onOrderEvent(event: BaseEvent, m: EntityManager, kind: 'placed' | null): Promise<void> {
    const p = event.payload as EcommerceOrderPlacedV1 | EcommerceOrderStatusChangedV1;
    const info = await this.ec.orderForEmailInTx(m, p.orderId);
    if (!info || !info.customerEmail) return;
    const which = kind ?? (p as EcommerceOrderStatusChangedV1).status;
    const msg = customerOrderEmail(info, which);
    if (!msg) return; // status that doesn't warrant a customer email
    await this.email.enqueue({ to: info.customerEmail, subject: msg.subject, text: msg.text });
    this.logger.log(`queued customer email for ${info.orderNo} (${which})`);
  }
}
