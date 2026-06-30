import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, EVENT_TYPES, type ProductionOrderCompletedV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { FeatureService } from '../features/feature.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import { FinanceService } from '../finance/finance.service';
import { ProductionService } from './production.service';
import { productionVoucher } from './production.util';

/**
 * Posts completed production to the general ledger. On `production.order_completed`, builds a journal
 * voucher (Dr finished-goods inventory; Cr raw materials / labour / overhead) from the event's cost
 * breakdown and the tenant's account map, and posts it through FinanceService inside the consumer's
 * idempotent tenant transaction. Skips gracefully when accounts aren't configured. Gated by
 * `WORKER_REACTIONS_ENABLED`.
 */
@Injectable()
export class ProductionGlConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductionGlConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly production: ProductionService,
    private readonly finance: FinanceService,
    private readonly features: FeatureService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Production GL posting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.PRODUCTION_ORDER_COMPLETED,
      consumer: 'production-gl-order',
      handler: (event, m) => this.onOrderCompleted(event, m),
    });
    this.logger.log('Production GL consumer registered (production.order_completed → journal voucher)');
  }

  async onOrderCompleted(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as ProductionOrderCompletedV1;
    // Accounts integration is opt-in per tenant: only post when Finance is entitled (ADR-009).
    if (!(await this.features.isEnabled(event.tenantId, 'finance'))) return;
    const accounts = await this.production.glConfigInTx(m);
    const producedAt = (await this.production.producedAtInTx(m, p.orderId)) ?? p.orderNo;
    const voucher = productionVoucher(accounts, {
      orderNo: p.orderNo,
      producedAt,
      materialMinor: p.materialCostMinor,
      operationMinor: p.operationCostMinor,
      overheadMinor: p.overheadMinor,
      totalMinor: p.totalCostMinor,
    });
    if (!voucher) {
      this.logger.debug(`skipping GL post for ${p.orderNo}: accounts not configured or zero cost`);
      return;
    }
    await this.finance.postJournalInTx(m, voucher as CreateTransactionDto);
    this.logger.log(`posted production ${p.orderNo} to GL (${p.totalCostMinor} ${p.currency})`);
  }
}
