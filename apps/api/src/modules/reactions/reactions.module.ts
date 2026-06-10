import { Module } from '@nestjs/common';
import { ReactionsService } from './reactions.service';

/** Event reaction handlers (low_stock/invoice_paid/deal_closed). */
@Module({
  providers: [ReactionsService],
})
export class ReactionsModule {}
