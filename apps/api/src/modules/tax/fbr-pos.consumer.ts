import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type BaseEvent, EVENT_TYPES, type PosSaleCompletedV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { FbrService } from './fbr.service';

/**
 * Auto-reports completed POS sales to FBR. On `pos.sale_completed` it asks {@link FbrService} to
 * report the sale — a no-op unless the tenant has the `tax` feature on and FBR enabled, and idempotent
 * per sale (so a redelivered event never double-reports). Gated by `WORKER_REACTIONS_ENABLED`.
 */
@Injectable()
export class FbrPosConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(FbrPosConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly fbr: FbrService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('FBR auto-report disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.POS_SALE_COMPLETED,
      consumer: 'fbr-pos-report',
      handler: (event) => this.onSaleCompleted(event),
    });
    this.logger.log('FBR consumer registered (pos.sale_completed → FBR report)');
  }

  private async onSaleCompleted(event: BaseEvent): Promise<void> {
    const payload = event.payload as PosSaleCompletedV1;
    await this.fbr.autoReportSaleFor(event.tenantId, payload.saleId);
  }
}
