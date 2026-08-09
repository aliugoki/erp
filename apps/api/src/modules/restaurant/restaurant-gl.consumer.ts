import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, EVENT_TYPES, type RestaurantBillSettledV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { FeatureService } from '../features/feature.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import { FinanceService } from '../finance/finance.service';
import { RestaurantGlService } from './restaurant-gl.service';
import { restaurantBillVoucher } from './restaurant-gl.util';
import type { Row } from './restaurant.util';

/**
 * Posts settled restaurant bills to the general ledger. On `restaurant.bill_settled` it reads the
 * tenant's restaurant GL account map, builds a balanced voucher from the event payload (Dr tenders /
 * Cr revenue + tax + service charge + tip + rounding; Dr COGS / Cr inventory) and posts it through
 * FinanceService inside the consumer's idempotent tenant transaction — so a redelivered event never
 * double-posts. Skips gracefully when Finance isn't entitled or accounts aren't configured. Gated by
 * `WORKER_REACTIONS_ENABLED`.
 */
@Injectable()
export class RestaurantGlConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(RestaurantGlConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly gl: RestaurantGlService,
    private readonly finance: FinanceService,
    private readonly features: FeatureService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Restaurant GL posting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.RESTAURANT_BILL_SETTLED,
      consumer: 'restaurant-gl-settle',
      handler: (event, m) => this.onBillSettled(event, m),
    });
    this.logger.log('Restaurant GL consumer registered (bill_settled → journal voucher)');
  }

  async onBillSettled(event: BaseEvent, m: EntityManager): Promise<void> {
    const bill = event.payload as RestaurantBillSettledV1;
    // GL integration is opt-in per tenant: only post when Finance is entitled (ADR-009).
    if (!(await this.features.isEnabled(event.tenantId, 'finance'))) return;
    const accounts = await this.gl.glConfigInTx(m);
    const occurredOn = await this.settledOn(m, bill.orderId);
    const voucher = restaurantBillVoucher(accounts, bill, occurredOn);
    if (!voucher) {
      this.logger.debug(`skipping GL post for ${bill.orderNo}: revenue account not configured or zero total`);
      return;
    }
    await this.finance.postJournalInTx(m, voucher as CreateTransactionDto);
    this.logger.log(`posted restaurant ${bill.orderNo} to GL (total ${bill.totalMinor} ${bill.currency})`);
  }

  /** The bill's settlement date (YYYY-MM-DD) for the voucher; falls back to today if unavailable. */
  private async settledOn(m: EntityManager, orderId: string): Promise<string> {
    const rows = (await m.query(
      `SELECT COALESCE(settled_at, now())::date::text AS d FROM restaurant_order WHERE id=$1`,
      [orderId],
    )) as Row[];
    return (rows[0]?.d as string) ?? new Date().toISOString().slice(0, 10);
  }
}
