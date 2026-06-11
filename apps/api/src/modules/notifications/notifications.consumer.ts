import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, type CrmDealClosedV1, EVENT_TYPES } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { NotificationsService } from './notifications.service';
import { EmailQueueService } from './email-queue.service';

function formatMinor(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Turns domain events into user-facing notifications (Chunk 5.1). Subscribes through the
 * IdempotentConsumer, so a notification is created exactly once per event even under redelivery, and a
 * failure is retried/dead-lettered. Flag-gated by `NOTIFICATIONS_ENABLED` (disabled in tests, which
 * drive {@link NotificationsService} directly). In-process per ADR-001.
 */
@Injectable()
export class NotificationsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly notifications: NotificationsService,
    private readonly email: EmailQueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('NOTIFICATIONS_ENABLED', { infer: true })) {
      this.logger.log('Notifications disabled (NOTIFICATIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.CRM_DEAL_CLOSED,
      consumer: 'notify-deal-closed',
      handler: (event, m) => this.onDealClosed(event, m),
    });
    this.logger.log('Notifications consumer registered (crm.deal_closed → assignee)');
  }

  /** crm.deal_closed → in-app notification for the deal's assignee (+ best-effort email). */
  async onDealClosed(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as CrmDealClosedV1;
    if (!p.assignedTo) return; // unassigned deal → no recipient

    const created = await this.notifications.createInTx(m, {
      userId: p.assignedTo,
      type: 'crm.deal_won',
      title: `Deal won: ${p.title}`,
      body: `Closed-won at ${formatMinor(p.valueMinor, p.currency)}.`,
      sourceEventId: event.id,
    });
    if (!created) return; // duplicate delivery — already notified

    // Email side-channel: look up the recipient within the tenant tx (RLS-scoped), enqueue best-effort.
    const rows = (await m.query(`SELECT email FROM users WHERE id=$1 AND deleted_at IS NULL`, [
      p.assignedTo,
    ])) as Array<{ email: string | null }>;
    const to = rows[0]?.email;
    if (to) {
      void this.email.enqueue({
        to,
        subject: `Deal won: ${p.title}`,
        text: `Congratulations — "${p.title}" was won at ${formatMinor(p.valueMinor, p.currency)}.`,
      });
    }
  }
}
