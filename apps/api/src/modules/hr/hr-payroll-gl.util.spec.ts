import { describe, expect, it } from 'vitest';
import { type ExpenseGroup, type HrPayrollGlAccounts, payrollRunVoucher } from './hr-payroll-gl.util';

const accts = (over: Partial<HrPayrollGlAccounts> = {}): HrPayrollGlAccounts => ({
  salaryExpenseAccountId: 'exp',
  salaryPayableAccountId: 'pay',
  deductionsPayableAccountId: 'ded',
  ...over,
});
const run = (
  expenseGroups: ExpenseGroup[],
  over: Partial<{ deductionMinor: number; netMinor: number }> = {},
) => ({ runNo: 'PAYRUN-0001', expenseGroups, deductionMinor: 15000, netMinor: 85000, occurredOn: '2026-06-30', ...over });

const sum = (entries: { debitMinor?: number; creditMinor?: number }[], side: 'debitMinor' | 'creditMinor') =>
  entries.reduce((t, e) => t + (e[side] ?? 0), 0);

describe('payrollRunVoucher', () => {
  it('posts Dr expense / Cr deductions + Cr net pay and stays balanced (single default expense)', () => {
    const v = payrollRunVoucher(accts(), run([{ accountId: null, grossMinor: 100000 }]))!;
    expect(v).not.toBeNull();
    expect(v.voucherType).toBe('JV');
    expect(v.reference).toBe('PAYRUN-0001');
    expect(v.entries).toHaveLength(3);
    expect(v.entries[0]).toMatchObject({ accountId: 'exp', debitMinor: 100000 }); // null → default expense
    expect(v.entries).toContainEqual({ accountId: 'ded', creditMinor: 15000 });
    expect(v.entries).toContainEqual({ accountId: 'pay', creditMinor: 85000 });
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
  });

  it('splits the expense debit per department account and stays balanced', () => {
    const v = payrollRunVoucher(
      accts(),
      run([{ accountId: 'exp-eng', grossMinor: 60000 }, { accountId: 'exp-ops', grossMinor: 40000 }]),
    )!;
    expect(v.entries).toContainEqual({ accountId: 'exp-eng', debitMinor: 60000 });
    expect(v.entries).toContainEqual({ accountId: 'exp-ops', debitMinor: 40000 });
    expect(v.entries).toContainEqual({ accountId: 'pay', creditMinor: 85000 });
    expect(sum(v.entries, 'debitMinor')).toBe(100000);
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
  });

  it('aggregates groups that resolve to the same account (department + fallback default)', () => {
    const v = payrollRunVoucher(
      accts(),
      run([{ accountId: 'exp', grossMinor: 30000 }, { accountId: null, grossMinor: 70000 }]),
    )!;
    // both resolve to 'exp' → a single merged debit line
    const expDebits = v.entries.filter((e) => e.accountId === 'exp' && e.debitMinor);
    expect(expDebits).toHaveLength(1);
    expect(expDebits[0]!.debitMinor).toBe(100000);
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
  });

  it('folds deductions into the salaries-payable credit when no deductions account is set', () => {
    const v = payrollRunVoucher(accts({ deductionsPayableAccountId: null }), run([{ accountId: null, grossMinor: 100000 }]))!;
    expect(v.entries).toHaveLength(2);
    expect(v.entries).toContainEqual({ accountId: 'pay', creditMinor: 100000 }); // full gross
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
  });

  it('handles a run with no deductions (gross == net)', () => {
    const v = payrollRunVoucher(accts(), run([{ accountId: null, grossMinor: 100000 }], { deductionMinor: 0, netMinor: 100000 }))!;
    expect(v.entries).toHaveLength(2);
    expect(v.entries).toContainEqual({ accountId: 'pay', creditMinor: 100000 });
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
  });

  it('clamps deductions to gross so a malformed run still balances', () => {
    const v = payrollRunVoucher(accts(), run([{ accountId: null, grossMinor: 100000 }], { deductionMinor: 999999999, netMinor: 0 }))!;
    expect(sum(v.entries, 'debitMinor')).toBe(sum(v.entries, 'creditMinor'));
    expect(v.entries).toContainEqual({ accountId: 'ded', creditMinor: 100000 }); // capped at gross
  });

  it('returns null when payable is unset, total gross is zero, or an unmapped dept has no default', () => {
    expect(payrollRunVoucher(accts({ salaryPayableAccountId: null }), run([{ accountId: null, grossMinor: 100000 }]))).toBeNull();
    expect(payrollRunVoucher(accts(), run([{ accountId: null, grossMinor: 0 }]))).toBeNull();
    // a department group with no account AND no tenant-level default → cannot post
    expect(payrollRunVoucher(accts({ salaryExpenseAccountId: null }), run([{ accountId: null, grossMinor: 100000 }]))).toBeNull();
  });
});
