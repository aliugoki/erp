import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import {
  type BaseEvent, EVENT_TYPES,
  type HelpdeskTicketCreatedV1, type HelpdeskTicketRepliedV1, type HelpdeskTicketResolvedV1,
} from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { HelpdeskService } from './helpdesk.service';
import { ticketEmail } from './helpdesk.util';

/**
 * Customer-facing emails for support tickets: an acknowledgement when a ticket is opened, a nudge when
 * an agent replies, and a resolution note (inviting a rating). Reads the ticket inside the consumer's
 * idempotent tenant transaction and hands a plain-text email to the (best-effort, retrying) queue —
 * exactly once per event. Gated by `NOTIFICATIONS_ENABLED`; delivery also needs
 * `NOTIFICATIONS_EMAIL_ENABLED`. Mirrors the ecommerce customer-email consumer.
 */
@Injectable()
export class HelpdeskEmailConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(HelpdeskEmailConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly hd: HelpdeskService,
    private readonly email: EmailQueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('NOTIFICATIONS_ENABLED', { infer: true })) {
      this.logger.log('Helpdesk customer emails disabled (NOTIFICATIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({ eventType: EVENT_TYPES.HELPDESK_TICKET_CREATED, consumer: 'helpdesk-email-created', handler: (e, m) => this.onCreated(e, m) });
    await this.consumer.register({ eventType: EVENT_TYPES.HELPDESK_TICKET_REPLIED, consumer: 'helpdesk-email-replied', handler: (e, m) => this.onReplied(e, m) });
    await this.consumer.register({ eventType: EVENT_TYPES.HELPDESK_TICKET_RESOLVED, consumer: 'helpdesk-email-resolved', handler: (e, m) => this.onResolved(e, m) });
    this.logger.log('Helpdesk customer-email consumer registered (created / replied / resolved)');
  }

  private async send(m: EntityManager, ticketId: string, to: string, kind: 'created' | 'replied' | 'resolved') {
    const t = await this.hd.ticketForNotifyInTx(m, ticketId);
    if (!t || !to) return;
    const slugRows = (await m.query(`SELECT slug FROM tenants WHERE id = current_setting('app.tenant_id')::uuid`)) as Array<{ slug: string }>;
    const base = this.config.get('STOREFRONT_BASE_URL', { infer: true });
    const slug = slugRows[0]?.slug;
    const link = base && slug ? `${base}/shop/${slug}/account/support/${t.ticketNo}` : null;
    const msg = ticketEmail(kind, { ticketNo: t.ticketNo, subject: t.subject, requesterName: t.requesterName, link, storeName: 'Support' });
    await this.email.enqueue({ to, subject: msg.subject, text: msg.text });
  }

  async onCreated(event: BaseEvent, m: EntityManager) {
    const p = event.payload as HelpdeskTicketCreatedV1;
    await this.send(m, p.ticketId, p.requesterEmail, 'created');
  }

  async onReplied(event: BaseEvent, m: EntityManager) {
    const p = event.payload as HelpdeskTicketRepliedV1;
    if (p.authorType !== 'AGENT') return; // only notify the customer of agent replies
    await this.send(m, p.ticketId, p.requesterEmail, 'replied');
  }

  async onResolved(event: BaseEvent, m: EntityManager) {
    const p = event.payload as HelpdeskTicketResolvedV1;
    await this.send(m, p.ticketId, p.requesterEmail, 'resolved');
  }
}
