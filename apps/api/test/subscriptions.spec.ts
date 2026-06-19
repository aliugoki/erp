import { describe, expect, it } from 'vitest';
import { intervalLiteral, monthlyMinor, subInvoiceVoucher, subscriptionEmail } from '../src/modules/subscriptions/subscriptions.util';

describe('subscriptions.util MRR normalisation', () => {
  it('normalises every interval to a monthly figure', () => {
    expect(monthlyMinor(10_000, 'MONTH', 1)).toBe(10_000); // monthly plan → itself
    expect(monthlyMinor(120_000, 'YEAR', 1)).toBe(10_000); // annual → /12
    expect(monthlyMinor(30_000, 'MONTH', 3)).toBe(10_000); // every 3 months → /3
    expect(monthlyMinor(1_000, 'DAY', 1)).toBe(30_000); // daily → ×30
  });

  it('scales by quantity', () => {
    expect(monthlyMinor(10_000, 'MONTH', 1, 5)).toBe(50_000);
  });
});

describe('subscriptions.util interval literal', () => {
  it('produces a safe Postgres interval from a validated interval + count', () => {
    expect(intervalLiteral('MONTH', 1)).toBe("interval '1 month'");
    expect(intervalLiteral('YEAR', 2)).toBe("interval '2 year'");
    // a non-positive count is clamped to 1 (never an empty/invalid interval)
    expect(intervalLiteral('WEEK', 0)).toBe("interval '1 week'");
  });
});

describe('subscriptions.util GL voucher', () => {
  const accounts = { clearingAccountId: 'clr', revenueAccountId: 'rev', taxAccountId: 'tax' };
  const inv = { invoiceNo: 'SINV-000001', amountMinor: 10_000, taxMinor: 1_700, totalMinor: 11_700, occurredOn: '2026-06-19' };

  it('builds a balanced voucher (Σ debit = Σ credit) splitting revenue and tax', () => {
    const v = subInvoiceVoucher(accounts, inv)!;
    const debit = v.entries.reduce((s, e) => s + (e.debitMinor ?? 0), 0);
    const credit = v.entries.reduce((s, e) => s + (e.creditMinor ?? 0), 0);
    expect(debit).toBe(11_700);
    expect(credit).toBe(11_700);
    expect(v.entries.find((e) => e.accountId === 'rev')!.creditMinor).toBe(10_000);
    expect(v.entries.find((e) => e.accountId === 'tax')!.creditMinor).toBe(1_700);
  });

  it('folds tax into revenue when no tax account is configured (still balanced)', () => {
    const v = subInvoiceVoucher({ ...accounts, taxAccountId: null }, inv)!;
    expect(v.entries.find((e) => e.accountId === 'rev')!.creditMinor).toBe(11_700);
    expect(v.entries.some((e) => e.accountId === 'tax')).toBe(false);
  });

  it('returns null when the minimum accounts are missing or total ≤ 0', () => {
    expect(subInvoiceVoucher({ ...accounts, revenueAccountId: null }, inv)).toBeNull();
    expect(subInvoiceVoucher(accounts, { ...inv, totalMinor: 0 })).toBeNull();
  });
});

describe('subscriptions.util customer emails', () => {
  const base = { customerName: 'Dana Scully', subscriptionNo: 'SUB-000001', invoiceNo: 'SINV-000001', totalMinor: 11_700, currency: 'PKR' };

  it('builds distinct emails per billing event', () => {
    expect(subscriptionEmail('receipt', base).subject).toContain('Payment received');
    expect(subscriptionEmail('receipt', base).text).toContain('PKR 117.00');
    expect(subscriptionEmail('dunning', { ...base, attemptCount: 2 }).subject).toContain('Action needed');
    expect(subscriptionEmail('dunning', { ...base, attemptCount: 2 }).text).toContain('attempt 2');
    expect(subscriptionEmail('canceled', { ...base, reason: 'DUNNING' }).text).toContain('failed payments');
  });

  it('omits the manage link when no portal URL is configured', () => {
    expect(subscriptionEmail('receipt', { ...base, link: null }).text).not.toContain('Manage your subscription');
  });
});
