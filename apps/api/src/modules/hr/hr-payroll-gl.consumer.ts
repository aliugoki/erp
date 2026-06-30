import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { type BaseEvent, EVENT_TYPES, type HrPayrollRunCompletedV1 } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';
import { IdempotentConsumer } from '../consumers/idempotent-consumer.service';
import { FeatureService } from '../features/feature.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import { FinanceService } from '../finance/finance.service';
import { HrEnterpriseService } from './hr-enterprise.service';
import { payrollRunVoucher } from './hr-payroll-gl.util';

/**
 * Posts approved payroll runs to the general ledger. On `hr.payroll_run_completed`, reads the run's
 * gross/deduction/net and the tenant's payroll GL account map, builds a balanced journal voucher
 * (Dr salary expense / Cr deductions payable / Cr salaries payable) and posts it through
 * FinanceService inside the consumer's idempotent tenant transaction, linking the voucher back to the
 * run. The accounts integration is **optional per tenant**: posting only happens when the tenant has
 * the `finance` feature enabled (authoritative gate, ADR-009) — HR-only tenants are unaffected. Also
 * skips gracefully when accounts aren't configured or the run already posted. Gated by
 * `WORKER_REACTIONS_ENABLED`.
 */
@Injectable()
export class HrPayrollGlConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(HrPayrollGlConsumer.name);

  constructor(
    private readonly consumer: IdempotentConsumer,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly hr: HrEnterpriseService,
    private readonly finance: FinanceService,
    private readonly features: FeatureService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Payroll GL posting disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    await this.consumer.register({
      eventType: EVENT_TYPES.HR_PAYROLL_RUN_COMPLETED,
      consumer: 'hr-gl-payroll',
      handler: (event, m) => this.onPayrollApproved(event, m),
    });
    this.logger.log('Payroll GL consumer registered (hr.payroll_run_completed → journal voucher)');
  }

  async onPayrollApproved(event: BaseEvent, m: EntityManager): Promise<void> {
    const p = event.payload as HrPayrollRunCompletedV1;
    // Accounts integration is opt-in per tenant: skip entirely unless Finance is entitled.
    if (!(await this.features.isEnabled(event.tenantId, 'finance'))) {
      this.logger.debug(`skipping GL post for run ${p.runId}: tenant has no finance feature`);
      return;
    }
    const accounts = await this.hr.payrollGlConfigInTx(m);
    const run = await this.hr.runForGlInTx(m, p.runId);
    if (!run) return; // run not found (shouldn't happen) — nothing to post
    if (run.journalId) {
      this.logger.debug(`skipping GL post for ${run.runNo}: already posted (${String(run.journalVoucherNo)})`);
      return;
    }
    const voucher = payrollRunVoucher(accounts, run);
    if (!voucher) {
      this.logger.debug(`skipping GL post for ${run.runNo}: payroll accounts not configured`);
      return;
    }
    const posted = (await this.finance.postJournalInTx(m, voucher as CreateTransactionDto)) as { id: string; voucherNo: string };
    await this.hr.linkRunJournalInTx(m, p.runId, posted.id, posted.voucherNo);
    this.logger.log(`posted payroll ${run.runNo} to GL (${posted.voucherNo})`);
  }
}
