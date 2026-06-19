import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import {
  type BaseEvent,
  type CrmDealClosedV1,
  type CrmLeadConvertedV1,
  type EcommerceOrderPlacedV1,
  EVENT_TYPES,
  type FinanceInvoicePaidV1,
  type HelpdeskSlaBreachedV1,
  type HelpdeskTicketAssignedV1,
  type HelpdeskTicketCreatedV1,
  type HelpdeskTicketRepliedV1,
  type HrLeaveApprovedV1,
  type HrPayrollRunCompletedV1,
  type InventoryLowStockV1,
  type ProductionOrderCompletedV1,
  type SubscriptionCanceledV1,
  type SubscriptionPaymentFailedV1,
} from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { NotificationsService } from './notifications.service';
import { EmailQueueService } from './email-queue.service';
import {
  type NotificationDraft,
  dealWonDraft,
  ecommerceOrderDraft,
  invoicePaidDraft,
  leadConvertedDraft,
  leaveApprovedDraft,
  lowStockDraft,
  payrollDraft,
  productionCompletedDraft,
  slaBreachedDraft,
  subscriptionCanceledDraft,
  subscriptionPaymentFailedDraft,
  ticketAssignedDraft,
  ticketCreatedDraft,
  ticketCustomerReplyDraft,
} from './notifications.util';

type Recipient = { id: string; email: string | null };

/**
 * Turns domain events into user-facing notifications (Chunk 5.1, completed). Subscribes through the
 * IdempotentConsumer, so notifications are created exactly once per event even under redelivery, and a
 * failure is retried/dead-lettered. Events addressed to a specific user (deal assignee, lead owner)
 * notify that user; operational events (low stock, invoice paid, payroll, production) fan out to the
 * relevant role. The in-app row honors the recipient's category preference; email is opt-in + best
 * effort. Flag-gated by `NOTIFICATIONS_ENABLED` (disabled in tests, which drive the consumer directly).
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
    const reg = (eventType: string, consumer: string, handler: (e: BaseEvent, m: EntityManager) => Promise<void>) =>
      this.consumer.register({ eventType, consumer, handler });

    await reg(EVENT_TYPES.CRM_DEAL_CLOSED, 'notify-deal-closed', (e, m) => this.onDealClosed(e, m));
    await reg(EVENT_TYPES.CRM_LEAD_CONVERTED, 'notify-lead-converted', (e, m) => this.onLeadConverted(e, m));
    await reg(EVENT_TYPES.INVENTORY_LOW_STOCK, 'notify-low-stock', (e, m) => this.onLowStock(e, m));
    await reg(EVENT_TYPES.FINANCE_INVOICE_PAID, 'notify-invoice-paid', (e, m) => this.onInvoicePaid(e, m));
    await reg(EVENT_TYPES.HR_LEAVE_APPROVED, 'notify-leave-approved', (e, m) => this.onLeaveApproved(e, m));
    await reg(EVENT_TYPES.HR_PAYROLL_RUN_COMPLETED, 'notify-payroll', (e, m) => this.onPayroll(e, m));
    await reg(EVENT_TYPES.PRODUCTION_ORDER_COMPLETED, 'notify-production', (e, m) => this.onProductionCompleted(e, m));
    await reg(EVENT_TYPES.ECOMMERCE_ORDER_PLACED, 'notify-ecommerce-order', (e, m) => this.onEcommerceOrder(e, m));
    await reg(EVENT_TYPES.HELPDESK_TICKET_CREATED, 'notify-ticket-created', (e, m) => this.onTicketCreated(e, m));
    await reg(EVENT_TYPES.HELPDESK_TICKET_ASSIGNED, 'notify-ticket-assigned', (e, m) => this.onTicketAssigned(e, m));
    await reg(EVENT_TYPES.HELPDESK_TICKET_REPLIED, 'notify-ticket-replied', (e, m) => this.onTicketReplied(e, m));
    await reg(EVENT_TYPES.HELPDESK_SLA_BREACHED, 'notify-sla-breached', (e, m) => this.onSlaBreached(e, m));
    await reg(EVENT_TYPES.SUBSCRIPTION_PAYMENT_FAILED, 'notify-subscription-failed', (e, m) => this.onSubscriptionPaymentFailed(e, m));
    await reg(EVENT_TYPES.SUBSCRIPTION_CANCELED, 'notify-subscription-canceled', (e, m) => this.onSubscriptionCanceled(e, m));
    this.logger.log('Notifications consumer registered (14 event types)');
  }

  /** crm.deal_closed → in-app notification for the deal's assignee (+ best-effort email if opted in). */
  async onDealClosed(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as CrmDealClosedV1;
    if (!p.assignedTo) return; // unassigned deal → no recipient
    await this.deliver(m, [await this.userRecipient(m, p.assignedTo)], dealWonDraft(p), event.id);
  }

  async onLeadConverted(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as CrmLeadConvertedV1;
    if (!p.ownerId) return;
    await this.deliver(m, [await this.userRecipient(m, p.ownerId)], leadConvertedDraft(p), event.id);
  }

  async onLowStock(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as InventoryLowStockV1;
    const rows = (await m.query(`SELECT name FROM inventory_product WHERE id=$1 AND deleted_at IS NULL`, [p.productId])) as Array<{ name: string }>;
    const recipients = await this.notifications.resolveRoleRecipients(m, ['INVENTORY_MANAGER', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, lowStockDraft(p, rows[0]?.name), event.id);
  }

  async onInvoicePaid(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as FinanceInvoicePaidV1;
    const recipients = await this.notifications.resolveRoleRecipients(m, ['FINANCE_MANAGER', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, invoicePaidDraft(p), event.id);
  }

  async onLeaveApproved(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as HrLeaveApprovedV1;
    const recipients = await this.notifications.resolveRoleRecipients(m, ['HR_MANAGER', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, leaveApprovedDraft(p), event.id);
  }

  async onPayroll(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as HrPayrollRunCompletedV1;
    const recipients = await this.notifications.resolveRoleRecipients(m, ['HR_MANAGER', 'FINANCE_MANAGER', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, payrollDraft(p), event.id);
  }

  async onProductionCompleted(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as ProductionOrderCompletedV1;
    const recipients = await this.notifications.resolveRoleRecipients(m, ['INVENTORY_MANAGER', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, productionCompletedDraft(p), event.id);
  }

  /** ecommerce.order_placed → notify the store's managers (sales reps + admins) of a new online order. */
  async onEcommerceOrder(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as EcommerceOrderPlacedV1;
    const recipients = await this.notifications.resolveRoleRecipients(m, ['SALES_REP', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, ecommerceOrderDraft(p), event.id);
  }

  /** helpdesk.ticket_created → notify the support team (agents + admins). */
  async onTicketCreated(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as HelpdeskTicketCreatedV1;
    const recipients = p.assignedTo
      ? [await this.userRecipient(m, p.assignedTo)]
      : await this.notifications.resolveRoleRecipients(m, ['SUPPORT_AGENT', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, ticketCreatedDraft(p), event.id);
  }

  /** helpdesk.ticket_assigned → notify the agent it was assigned to. */
  async onTicketAssigned(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as HelpdeskTicketAssignedV1;
    await this.deliver(m, [await this.userRecipient(m, p.assignedTo)], ticketAssignedDraft(p), event.id);
  }

  /** helpdesk.ticket_replied (by the CUSTOMER) → notify the assigned agent. */
  async onTicketReplied(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as HelpdeskTicketRepliedV1;
    if (p.authorType !== 'CUSTOMER' || !p.assignedTo) return;
    await this.deliver(m, [await this.userRecipient(m, p.assignedTo)], ticketCustomerReplyDraft(p), event.id);
  }

  /** helpdesk.sla_breached → alert the assigned agent (or the support team). */
  async onSlaBreached(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as HelpdeskSlaBreachedV1;
    const recipients = p.assignedTo
      ? [await this.userRecipient(m, p.assignedTo)]
      : await this.notifications.resolveRoleRecipients(m, ['SUPPORT_AGENT', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, slaBreachedDraft(p), event.id);
  }

  /** subscription.payment_failed → alert the billing/finance team that a charge failed. */
  async onSubscriptionPaymentFailed(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as SubscriptionPaymentFailedV1;
    const recipients = await this.notifications.resolveRoleRecipients(m, ['FINANCE_MANAGER', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, subscriptionPaymentFailedDraft(p), event.id);
  }

  /** subscription.canceled → tell the billing/finance team (notably dunning-driven cancellations). */
  async onSubscriptionCanceled(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as SubscriptionCanceledV1;
    const recipients = await this.notifications.resolveRoleRecipients(m, ['FINANCE_MANAGER', 'TENANT_ADMIN']);
    await this.deliver(m, recipients, subscriptionCanceledDraft(p), event.id);
  }

  /** Create the in-app row per recipient (idempotent) and fan out opt-in emails (best effort). */
  private async deliver(m: EntityManager, recipients: Recipient[], draft: NotificationDraft, sourceEventId: string): Promise<void> {
    for (const r of recipients) {
      const created = await this.notifications.createInTx(m, { userId: r.id, ...draft, sourceEventId });
      if (!created) continue; // duplicate delivery or category muted in-app
      if (r.email && (await this.notifications.emailEnabled(m, r.id, draft.category))) {
        void this.email.enqueue({ to: r.email, subject: draft.title, text: draft.body });
      }
    }
  }

  private async userRecipient(m: EntityManager, userId: string): Promise<Recipient> {
    const rows = (await m.query(`SELECT email FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId])) as Array<{ email: string | null }>;
    return { id: userId, email: rows[0]?.email ?? null };
  }
}
