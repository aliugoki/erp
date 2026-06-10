import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVENT_TYPES } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { handleDealClosed, handleInvoicePaid, handleLowStock } from './handlers';

/**
 * Registers the event reaction consumers (Chunk 4.4) when enabled. Each subscribes through the
 * IdempotentConsumer, so reactions are idempotent under redelivery and retried/dead-lettered on
 * failure. Per ADR-001 these run in-process (single runtime) until a measured throughput need
 * justifies a separate Go worker; disabled by default (e.g. in tests).
 */
@Injectable()
export class ReactionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReactionsService.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Event reactions disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({ eventType: EVENT_TYPES.INVENTORY_LOW_STOCK, consumer: 'worker-inventory', handler: handleLowStock });
    await this.consumer.register({ eventType: EVENT_TYPES.FINANCE_INVOICE_PAID, consumer: 'worker-finance', handler: handleInvoicePaid });
    await this.consumer.register({ eventType: EVENT_TYPES.CRM_DEAL_CLOSED, consumer: 'worker-crm', handler: handleDealClosed });
    this.logger.log('Event reactions registered (inventory/finance/crm)');
  }
}
