import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import {
  type BaseEvent, EVENT_TYPES,
  type SubscriptionCanceledV1, type SubscriptionInvoicePaidV1, type SubscriptionPaymentFailedV1,
} from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { SubscriptionsService } from './subscriptions.service';
import { subscriptionEmail } from './subscriptions.util';

/**
 * Customer-facing billing emails: a receipt when an invoice is paid, a dunning notice when a charge
 * fails, and a note when a subscription is cancelled. Reads the subscriber inside the consumer's
 * idempotent tenant transaction and hands a plain-text email to the (best-effort, retrying) queue —
 * exactly once per event. Gated by `NOTIFICATIONS_ENABLED`; delivery also needs
 * `NOTIFICATIONS_EMAIL_ENABLED`. Mirrors the helpdesk customer-email consumer.
 */
@Injectable()
export class SubscriptionsEmailConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriptionsEmailConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly subs: SubscriptionsService,
    private readonly email: EmailQueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('NOTIFICATIONS_ENABLED', { infer: true })) {
      this.logger.log('Subscription customer emails disabled (NOTIFICATIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({ eventType: EVENT_TYPES.SUBSCRIPTION_INVOICE_PAID, consumer: 'subscription-email-paid', handler: (e, m) => this.onPaid(e, m) });
    await this.consumer.register({ eventType: EVENT_TYPES.SUBSCRIPTION_PAYMENT_FAILED, consumer: 'subscription-email-failed', handler: (e, m) => this.onFailed(e, m) });
    await this.consumer.register({ eventType: EVENT_TYPES.SUBSCRIPTION_CANCELED, consumer: 'subscription-email-canceled', handler: (e, m) => this.onCanceled(e, m) });
    this.logger.log('Subscription customer-email consumer registered (receipt / dunning / cancellation)');
  }

  private async portalLink(m: EntityManager, subscriptionNo: string): Promise<string | null> {
    const slugRows = (await m.query(`SELECT slug FROM tenants WHERE id = current_setting('app.tenant_id')::uuid`)) as Array<{ slug: string }>;
    const base = this.config.get('STOREFRONT_BASE_URL', { infer: true });
    const slug = slugRows[0]?.slug;
    return base && slug ? `${base}/shop/${slug}/account/subscriptions/${subscriptionNo}` : null;
  }

  async onPaid(event: BaseEvent, m: EntityManager) {
    const p = event.payload as SubscriptionInvoicePaidV1;
    const info = await this.subs.subscriptionForNotifyInTx(m, p.subscriptionId);
    if (!info || !p.customerEmail) return;
    const msg = subscriptionEmail('receipt', {
      customerName: info.customerName, subscriptionNo: info.subscriptionNo, invoiceNo: p.invoiceNo,
      totalMinor: p.totalMinor, currency: p.currency, link: await this.portalLink(m, info.subscriptionNo), storeName: 'Billing',
    });
    await this.email.enqueue({ to: p.customerEmail, subject: msg.subject, text: msg.text });
  }

  async onFailed(event: BaseEvent, m: EntityManager) {
    const p = event.payload as SubscriptionPaymentFailedV1;
    const info = await this.subs.subscriptionForNotifyInTx(m, p.subscriptionId);
    if (!info || !p.customerEmail) return;
    const msg = subscriptionEmail('dunning', {
      customerName: info.customerName, subscriptionNo: info.subscriptionNo, invoiceNo: p.invoiceNo,
      totalMinor: p.totalMinor, currency: p.currency, attemptCount: p.attemptCount,
      link: await this.portalLink(m, info.subscriptionNo), storeName: 'Billing',
    });
    await this.email.enqueue({ to: p.customerEmail, subject: msg.subject, text: msg.text });
  }

  async onCanceled(event: BaseEvent, m: EntityManager) {
    const p = event.payload as SubscriptionCanceledV1;
    const info = await this.subs.subscriptionForNotifyInTx(m, p.subscriptionId);
    if (!info || !p.customerEmail) return;
    const msg = subscriptionEmail('canceled', {
      customerName: info.customerName, subscriptionNo: p.subscriptionNo, reason: p.reason,
      link: await this.portalLink(m, p.subscriptionNo), storeName: 'Billing',
    });
    await this.email.enqueue({ to: p.customerEmail, subject: msg.subject, text: msg.text });
  }
}
