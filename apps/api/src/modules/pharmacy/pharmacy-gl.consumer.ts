import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, EVENT_TYPES, type PharmacyDispenseCompletedV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import { FinanceService } from '../finance/finance.service';
import { PharmacyService } from './pharmacy.service';
import { PharmacyDispenseService } from './pharmacy-dispense.service';
import { pharmacyDispenseVoucher, type PharmacyGlAccounts } from './pharmacy-gl.util';

/**
 * Posts pharmacy dispenses to the general ledger. On `pharmacy.dispense_completed`, reads the
 * dispense + the tenant's pharmacy GL account map, builds a balanced voucher (Dr debtor / Cr revenue
 * [+ tax]; Dr COGS / Cr inventory — reversed when the dispense is RETURNED/VOID) and posts it through
 * FinanceService inside the consumer's idempotent tenant transaction. Skips gracefully when accounts
 * aren't configured. Gated by `WORKER_REACTIONS_ENABLED`.
 */
@Injectable()
export class PharmacyGlConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(PharmacyGlConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly pharmacy: PharmacyService,
    private readonly dispense: PharmacyDispenseService,
    private readonly finance: FinanceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Pharmacy GL posting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.PHARMACY_DISPENSE_COMPLETED,
      consumer: 'pharmacy-gl-dispense',
      handler: (event, m) => this.onDispenseCompleted(event, m),
    });
    this.logger.log('Pharmacy GL consumer registered (pharmacy.dispense_completed → journal voucher)');
  }

  async onDispenseCompleted(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as PharmacyDispenseCompletedV1;
    const accounts = (await this.pharmacy.glConfigInTx(m)) as PharmacyGlAccounts;
    const dispense = await this.dispense.dispenseForGlInTx(m, p.dispenseId);
    if (!dispense) return; // not found — nothing to post
    const voucher = pharmacyDispenseVoucher(accounts, dispense);
    if (!voucher) {
      this.logger.debug(`skipping GL post for ${p.dispenseNo}: accounts not configured`);
      return;
    }
    await this.finance.postJournalInTx(m, voucher as CreateTransactionDto);
    this.logger.log(`posted pharmacy ${p.dispenseNo} (${dispense.status}) to GL`);
  }
}
