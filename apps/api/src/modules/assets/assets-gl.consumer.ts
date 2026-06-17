import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type AssetDepreciationPostedV1, type BaseEvent, EVENT_TYPES } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import { FinanceService } from '../finance/finance.service';
import { AssetsService } from './assets.service';
import { depreciationVoucher } from './assets.util';

/**
 * Posts depreciation to the general ledger. On `asset.depreciation_posted`, builds a journal voucher
 * (Dr depreciation expense, Cr accumulated depreciation) from the tenant's configured GL accounts and
 * posts it through {@link FinanceService.postJournalInTx} — inside the consumer's idempotent tenant
 * transaction, so the voucher commits exactly once per run alongside the dedupe row. When the GL
 * accounts aren't configured (or the amount is zero) it skips gracefully; the asset depreciation
 * entries are unaffected either way. Gated by `WORKER_REACTIONS_ENABLED` (it's an event reaction).
 */
@Injectable()
export class AssetGlConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssetGlConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly assets: AssetsService,
    private readonly finance: FinanceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Asset GL posting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.ASSET_DEPRECIATION_POSTED,
      consumer: 'asset-gl-depreciation',
      handler: (event, m) => this.onDepreciationPosted(event, m),
    });
    this.logger.log('Asset GL consumer registered (asset.depreciation_posted → journal voucher)');
  }

  async onDepreciationPosted(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as AssetDepreciationPostedV1;
    const accounts = await this.assets.glConfigInTx(m);
    const voucher = depreciationVoucher(accounts, { runNo: p.runNo, period: p.period, totalMinor: p.totalMinor });
    if (!voucher) {
      this.logger.debug(`skipping GL post for ${p.runNo}: accounts not configured or zero amount`);
      return;
    }
    await this.finance.postJournalInTx(m, voucher as CreateTransactionDto);
    this.logger.log(`posted depreciation ${p.runNo} to GL (${p.totalMinor} ${p.currency})`);
  }
}
