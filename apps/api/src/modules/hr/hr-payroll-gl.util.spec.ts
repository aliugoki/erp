import { describe, expect, it } from 'vitest';
import { type HrPayrollGlAccounts, payrollRunVoucher } from './hr-payroll-gl.util';

const accts = (over: Partial<HrPayrollGlAccounts> = {}): HrPayrollGlAccounts => ({
  salaryExpenseAccountId: 'exp',
  salaryPayableAccountId: 'pay',
  deductionsPayableAccountId: 'ded',
  ...over,
});
const run = { runNo: 'PAYRUN-0001', grossMinor: 100000, deductionMinor: 15000, netMinor: 85000, occurredOn: '2026-06-30' };

const sum = (entries: { debitMinor?: number; creditMinor?: number }[], side: 'debitMinor' | 'creditMinor') =>
  entries.reduce((t, e) => t + (e[side] ?? 0), 0);

describe('payrollRunVoucher', () => {
  it('posts Dr expense / Cr deductions + Cr net pay and stays balanced', () => {
    const v = payrollRunVoucher(accts(), run)!;
    expect(v).not.toBeNull();
    expect(v.voucherType).toBe('JV');
    expect(v.reference).toBe('PAYRUN-0001');
    expect(v.entries).toHaveLength(3);
    expect(v.entries[0]).toMatchObject({ accountId: 'exp', debitMinor: 100000 });
    expect(v.entries).toContainEqual({ accountId: 'ded', creditMinor: 15000 });
    expect(v.entries).toContainEqual({ accountId: 'pay', creditMinor: 85000 });
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
  });

  it('folds deductions into the salaries-payable credit when no deductions account is set', () => {
    const v = payrollRunVoucher(accts({ deductionsPayableAccountId: null }), run)!;
    expect(v.entries).toHaveLength(2);
    expect(v.entries).toContainEqual({ accountId: 'pay', creditMinor: 100000 }); // full gross
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
  });

  it('handles a run with no deductions (gross == net)', () => {
    const v = payrollRunVoucher(accts(), { ...run, deductionMinor: 0, netMinor: 100000 })!;
    expect(v.entries).toHaveLength(2);
    expect(v.entries).toContainEqual({ accountId: 'pay', creditMinor: 100000 });
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
  });

  it('clamps deductions to gross so a malformed run still balances', () => {
    const v = payrollRunVoucher(accts(), { ...run, deductionMinor: 999999999, netMinor: 0 })!;
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
    expect(v.entries).toContainEqual({ accountId: 'ded', creditMinor: 100000 }); // capped at gross
  });

  it('returns null when required accounts are missing or gross is zero', () => {
    expect(payrollRunVoucher(accts({ salaryExpenseAccountId: null }), run)).toBeNull();
    expect(payrollRunVoucher(accts({ salaryPayableAccountId: null }), run)).toBeNull();
    expect(payrollRunVoucher(accts(), { ...run, grossMinor: 0 })).toBeNull();
  });
});
