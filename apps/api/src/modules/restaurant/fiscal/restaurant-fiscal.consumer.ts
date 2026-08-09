import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, EVENT_TYPES, type RestaurantBillSettledV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../../consumers/idempotent-consumer.service';
import { FeatureService } from '../../features/feature.service';
import { RestaurantFiscalService } from './fiscal.service';

/**
 * Auto-reports settled restaurant bills to the configured tax authority (PRA/FBR/SRB/KPRA/BRA). On
 * `restaurant.bill_settled` it asks {@link RestaurantFiscalService} to report — a no-op unless the
 * branch has fiscalization enabled and an authority set — idempotent per order (a redelivered event
 * never double-reports). A live authority failure surfaces to the consumer's retry/backoff/DLQ. Gated
 * by `WORKER_REACTIONS_ENABLED`.
 */
@Injectable()
export class RestaurantFiscalConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(RestaurantFiscalConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly fiscal: RestaurantFiscalService,
    private readonly features: FeatureService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Restaurant fiscal reporting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.RESTAURANT_BILL_SETTLED,
      consumer: 'restaurant-fiscal-report',
      handler: (event, m) => this.onBillSettled(event, m),
    });
    this.logger.log('Restaurant fiscal consumer registered (bill_settled → tax-authority report)');
  }

  private async onBillSettled(event: BaseEvent, m: EntityManager): Promise<void> {
    if (!(await this.features.isEnabled(event.tenantId, 'restaurant'))) return;
    await this.fiscal.reportSettledBill(m, event.payload as RestaurantBillSettledV1);
  }
}
