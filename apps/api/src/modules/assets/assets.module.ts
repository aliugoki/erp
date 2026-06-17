import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AssetGlConsumer } from './assets-gl.consumer';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

/**
 * Fixed Asset Management. Depreciation totals post to finance: the AssetGlConsumer turns each
 * `asset.depreciation_posted` event into a journal voucher via FinanceService (Dr expense, Cr
 * accumulated). Depreciation totals also emit to the outbox (OutboxModule is global).
 */
@Module({
  imports: [FinanceModule],
  controllers: [AssetsController],
  providers: [AssetsService, AssetGlConsumer],
})
export class AssetsModule {}
