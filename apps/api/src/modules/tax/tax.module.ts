import { Module } from '@nestjs/common';
import { FbrClient } from './fbr.client';
import { FbrController } from './fbr.controller';
import { FbrService } from './fbr.service';

/** Tax & compliance. FBR (Federal Board of Revenue, Pakistan) digital-invoicing first; structured to
 * add further tax authorities/integrations later. */
@Module({
  controllers: [FbrController],
  providers: [FbrService, FbrClient],
  exports: [FbrService],
})
export class TaxModule {}
