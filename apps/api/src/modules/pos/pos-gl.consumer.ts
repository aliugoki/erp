import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, EVENT_TYPES, type PosSaleCompletedV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import { FinanceService } from '../finance/finance.service';
import { PosService } from './pos.service';
import { posSaleVoucher } from './pos.util';

/**
 * Posts POS sales to the general ledger. On `pos.sale_completed`, reads the sale's totals and the
 * tenant's POS GL account map, builds a balanced journal voucher (Dr clearing / Cr revenue [+ tax];
 * Dr COGS / Cr inventory — reversed for a RETURN) and posts it through FinanceService inside the
 * consumer's idempotent tenant transaction. Skips gracefully when accounts aren't configured. Gated
 * by `WORKER_REACTIONS_ENABLED`.
 */
@Injectable()
export class PosGlConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(PosGlConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly pos: PosService,
    private readonly finance: FinanceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('POS GL posting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.POS_SALE_COMPLETED,
      consumer: 'pos-gl-sale',
      handler: (event, m) => this.onSaleCompleted(event, m),
    });
    this.logger.log('POS GL consumer registered (pos.sale_completed → journal voucher)');
  }

  async onSaleCompleted(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as PosSaleCompletedV1;
    const accounts = await this.pos.glConfigInTx(m);
    const sale = await this.pos.saleForGlInTx(m, p.saleId);
    if (!sale) return; // sale not found (shouldn't happen) — nothing to post
    const voucher = posSaleVoucher(accounts, sale);
    if (!voucher) {
      this.logger.debug(`skipping GL post for ${p.saleNo}: accounts not configured`);
      return;
    }
    await this.finance.postJournalInTx(m, voucher as CreateTransactionDto);
    this.logger.log(`posted POS ${p.saleNo} (${sale.type}) to GL`);
  }
}
