import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { HrPayrollGlConsumer } from './hr-payroll-gl.consumer';

const event = { tenantId: 't1', payload: { runId: 'r1' } } as never;
const m = {} as EntityManager;

describe('HrPayrollGlConsumer.onPayrollApproved (optional accounts integration)', () => {
  it('skips entirely when the tenant has no finance feature — no DB read, no GL post', async () => {
    const features = { isEnabled: vi.fn().mockResolvedValue(false) };
    const hr = { payrollGlConfigInTx: vi.fn(), runForGlInTx: vi.fn(), linkRunJournalInTx: vi.fn() };
    const finance = { postJournalInTx: vi.fn() };
    const consumer = new HrPayrollGlConsumer({} as never, {} as never, hr as never, finance as never, features as never);

    await consumer.onPayrollApproved(event, m);

    expect(features.isEnabled).toHaveBeenCalledWith('t1', 'finance');
    expect(hr.payrollGlConfigInTx).not.toHaveBeenCalled(); // no work when finance is off
    expect(finance.postJournalInTx).not.toHaveBeenCalled();
  });

  it('does not post when finance is on but the run is already posted (idempotency guard)', async () => {
    const features = { isEnabled: vi.fn().mockResolvedValue(true) };
    const hr = {
      payrollGlConfigInTx: vi.fn().mockResolvedValue({ salaryExpenseAccountId: 'e', salaryPayableAccountId: 'p', deductionsPayableAccountId: null }),
      runForGlInTx: vi.fn().mockResolvedValue({ runNo: 'PAYRUN-0001', expenseGroups: [{ accountId: null, grossMinor: 1000 }], deductionMinor: 0, netMinor: 1000, occurredOn: '2026-06-30', journalId: 'already', journalVoucherNo: 'JV-000001' }),
      linkRunJournalInTx: vi.fn(),
    };
    const finance = { postJournalInTx: vi.fn() };
    const consumer = new HrPayrollGlConsumer({} as never, {} as never, hr as never, finance as never, features as never);

    await consumer.onPayrollApproved(event, m);

    expect(finance.postJournalInTx).not.toHaveBeenCalled(); // journalId set → skip
  });
});
