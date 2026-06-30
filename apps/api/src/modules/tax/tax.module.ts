import { Module } from '@nestjs/common';
import { FbrClient } from './fbr.client';
import { FbrController } from './fbr.controller';
import { FbrPosConsumer } from './fbr-pos.consumer';
import { FbrService } from './fbr.service';

/** Tax & compliance. FBR (Federal Board of Revenue, Pakistan) digital-invoicing first; structured to
 * add further tax authorities/integrations later. Auto-reports completed POS sales via FbrPosConsumer. */
@Module({
  controllers: [FbrController],
  providers: [FbrService, FbrClient, FbrPosConsumer],
  exports: [FbrService],
})
export class TaxModule {}
