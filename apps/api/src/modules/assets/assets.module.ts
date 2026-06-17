import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

/** Fixed Asset Management. Depreciation totals post to finance via the outbox (OutboxModule is global). */
@Module({
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
