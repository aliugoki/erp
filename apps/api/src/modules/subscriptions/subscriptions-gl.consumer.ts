import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, EVENT_TYPES, type SubscriptionInvoicePaidV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import { FinanceService } from '../finance/finance.service';
import { SubscriptionsService } from './subscriptions.service';
import { subInvoiceVoucher } from './subscriptions.util';

/**
 * Posts paid subscription invoices to the general ledger. On `subscription.invoice_paid`, reads the
 * invoice totals + the tenant's subscription GL account map, builds a balanced journal voucher (Dr
 * clearing / Cr revenue [+ tax]) and posts it through FinanceService inside the consumer's idempotent
 * tenant transaction. Skips gracefully when accounts aren't configured. Gated by
 * `WORKER_REACTIONS_ENABLED`. Mirrors the ecommerce GL consumer.
 */
@Injectable()
export class SubscriptionsGlConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriptionsGlConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly subs: SubscriptionsService,
    private readonly finance: FinanceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Subscription GL posting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.SUBSCRIPTION_INVOICE_PAID,
      consumer: 'subscription-gl-invoice',
      handler: (event, m) => this.onInvoicePaid(event, m),
    });
    this.logger.log('Subscription GL consumer registered (subscription.invoice_paid → journal voucher)');
  }

  async onInvoicePaid(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as SubscriptionInvoicePaidV1;
    const accounts = await this.subs.glConfigInTx(m);
    const inv = await this.subs.invoiceForGlInTx(m, p.invoiceId);
    if (!inv) return;
    const voucher = subInvoiceVoucher(accounts, inv);
    if (!voucher) {
      this.logger.debug(`skipping GL post for ${p.invoiceNo}: accounts not configured`);
      return;
    }
    await this.finance.postJournalInTx(m, voucher as CreateTransactionDto);
    this.logger.log(`posted subscription invoice ${p.invoiceNo} to GL`);
  }
}
