import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, EVENT_TYPES, type EcommerceOrderPlacedV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { FeatureService } from '../features/feature.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import { FinanceService } from '../finance/finance.service';
import { EcommerceService } from './ecommerce.service';
import { ecOrderVoucher } from './ecommerce.util';

/**
 * Posts placed online orders to the general ledger. On `ecommerce.order_placed`, reads the order's
 * totals + the tenant's ecommerce GL account map, builds a balanced journal voucher (Dr clearing / Cr
 * revenue [+ tax, + shipping]; Dr COGS / Cr inventory) and posts it through FinanceService inside the
 * consumer's idempotent tenant transaction. Skips gracefully when accounts aren't configured. Gated by
 * `WORKER_REACTIONS_ENABLED`. Mirrors the POS GL consumer.
 */
@Injectable()
export class EcommerceGlConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(EcommerceGlConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly ec: EcommerceService,
    private readonly finance: FinanceService,
    private readonly features: FeatureService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Ecommerce GL posting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.ECOMMERCE_ORDER_PLACED,
      consumer: 'ecommerce-gl-order',
      handler: (event, m) => this.onOrderPlaced(event, m),
    });
    this.logger.log('Ecommerce GL consumer registered (ecommerce.order_placed → journal voucher)');
  }

  async onOrderPlaced(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as EcommerceOrderPlacedV1;
    // Accounts integration is opt-in per tenant: only post when Finance is entitled (ADR-009).
    if (!(await this.features.isEnabled(event.tenantId, 'finance'))) return;
    const accounts = await this.ec.glConfigInTx(m);
    const order = await this.ec.orderForGlInTx(m, p.orderId);
    if (!order) return;
    const voucher = ecOrderVoucher(accounts, order);
    if (!voucher) {
      this.logger.debug(`skipping GL post for ${p.orderNo}: accounts not configured`);
      return;
    }
    await this.finance.postJournalInTx(m, voucher as CreateTransactionDto);
    this.logger.log(`posted online order ${p.orderNo} to GL`);
  }
}
