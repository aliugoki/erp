/**
 * Finance unit tests (Chunk 3.2). The double-entry balance invariant + money-as-integers are the
 * heart of this module, so they are unit-tested directly. DB integration is in finance-e2e.sh.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ACCOUNT_LEVELS,
  UnbalancedTransactionError,
  VOUCHER_TYPES,
  VoucherValidationError,
  assertBalanced,
  assertVoucherType,
  computeInvoiceTotals,
  formatVoucherNo,
  normalBalance,
  signedBalanceMinor,
  trialColumns,
  voucherLabel,
} from '../src/modules/finance/finance.util';

describe('assertBalanced (double-entry invariant)', () => {
  it('accepts a balanced transaction', () => {
    expect(
      assertBalanced([
        { accountId: 'a', debitMinor: 100000 },
        { accountId: 'b', creditMinor: 100000 },
      ]),
    ).toEqual({ debit: 100000, credit: 100000 });
  });

  it('accepts a multi-line balanced transaction', () => {
    const r = assertBalanced([
      { accountId: 'a', debitMinor: 70000 },
      { accountId: 'b', debitMinor: 30000 },
      { accountId: 'c', creditMinor: 100000 },
    ]);
    expect(r).toEqual({ debit: 100000, credit: 100000 });
  });

  it('REJECTS an unbalanced transaction', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debitMinor: 100000 },
        { accountId: 'b', creditMinor: 90000 },
      ]),
    ).toThrow(UnbalancedTransactionError);
  });

  it('REJECTS a float amount (money is integer minor units only)', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debitMinor: 100.5 },
        { accountId: 'b', creditMinor: 100.5 },
      ]),
    ).toThrow(/integer minor units/);
  });

  it('rejects an entry that is both debit and credit', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debitMinor: 100, creditMinor: 100 },
        { accountId: 'b', creditMinor: 100 },
      ]),
    ).toThrow(/debit or a credit/);
  });

  it('rejects fewer than two entries', () => {
    expect(() => assertBalanced([{ accountId: 'a', debitMinor: 100 }])).toThrow(/at least two/);
  });
});

describe('computeInvoiceTotals', () => {
  it('sums line totals with integer math and adds tax', () => {
    expect(
      computeInvoiceTotals(
        [
          { description: 'Widget', quantity: 3, unitPriceMinor: 50000 },
          { description: 'Gadget', quantity: 2, unitPriceMinor: 25000 },
        ],
        20000,
      ),
    ).toEqual({ subtotalMinor: 200000, taxMinor: 20000, totalMinor: 220000 });
  });
});

describe('account normal-balance semantics', () => {
  it('assets and expenses are debit-normal; liabilities, equity, revenue are credit-normal', () => {
    expect(normalBalance('ASSET')).toBe('DEBIT');
    expect(normalBalance('EXPENSE')).toBe('DEBIT');
    expect(normalBalance('LIABILITY')).toBe('CREDIT');
    expect(normalBalance('EQUITY')).toBe('CREDIT');
    expect(normalBalance('REVENUE')).toBe('CREDIT');
  });

  it('signedBalanceMinor returns a positive value for a natural balance', () => {
    // Asset (debit-normal) with more debits → positive.
    expect(signedBalanceMinor('ASSET', 100000, 30000)).toBe(70000);
    // Revenue (credit-normal) with more credits → positive.
    expect(signedBalanceMinor('REVENUE', 0, 100000)).toBe(100000);
    // Liability paid down below zero → negative (abnormal).
    expect(signedBalanceMinor('LIABILITY', 120000, 100000)).toBe(-20000);
  });

  it('trialColumns puts a positive net in debit, a negative net in credit (abs)', () => {
    expect(trialColumns(70000)).toEqual({ debitMinor: 70000, creditMinor: 0 });
    expect(trialColumns(-40000)).toEqual({ debitMinor: 0, creditMinor: 40000 });
    expect(trialColumns(0)).toEqual({ debitMinor: 0, creditMinor: 0 });
  });

  it('exposes the five voucher types and a 4-level cap', () => {
    expect([...VOUCHER_TYPES]).toEqual(['BRV', 'BPV', 'CPV', 'CRV', 'JV']);
    expect(MAX_ACCOUNT_LEVELS).toBe(4);
    expect(voucherLabel('BRV')).toBe('Bank Receipt Voucher');
    expect(voucherLabel('CPV')).toBe('Cash Payment Voucher');
  });

  it('formatVoucherNo zero-pads to a per-type running number', () => {
    expect(formatVoucherNo('BRV', 1)).toBe('BRV-000001');
    expect(formatVoucherNo('JV', 4242)).toBe('JV-004242');
  });

  it('assertVoucherType enforces cash/bank sides per voucher type', () => {
    const bankDr = { controlType: 'BANK' as const, debitMinor: 1000, creditMinor: 0 };
    const bankCr = { controlType: 'BANK' as const, debitMinor: 0, creditMinor: 1000 };
    const cashDr = { controlType: 'CASH' as const, debitMinor: 1000, creditMinor: 0 };
    const cashCr = { controlType: 'CASH' as const, debitMinor: 0, creditMinor: 1000 };
    const other = { controlType: 'NONE' as const, debitMinor: 0, creditMinor: 1000 };

    expect(() => assertVoucherType('BRV', [bankDr, other])).not.toThrow();
    expect(() => assertVoucherType('BRV', [cashDr, other])).toThrow(VoucherValidationError);
    expect(() => assertVoucherType('BPV', [bankCr, { ...other, debitMinor: 1000, creditMinor: 0 }])).not.toThrow();
    expect(() => assertVoucherType('CRV', [cashDr, other])).not.toThrow();
    expect(() => assertVoucherType('CPV', [cashCr, { ...other, debitMinor: 1000, creditMinor: 0 }])).not.toThrow();
    expect(() => assertVoucherType('CPV', [bankCr, { ...other, debitMinor: 1000, creditMinor: 0 }])).toThrow(VoucherValidationError);
    // JV has no cash/bank constraint.
    expect(() => assertVoucherType('JV', [other, { ...other, debitMinor: 1000, creditMinor: 0 }])).not.toThrow();
  });

  it('a balanced ledger trial-balances to equal debit and credit totals', () => {
    // Dr Cash 100 / Cr Revenue 100 → cash net +100 (debit col), revenue net -100 raw (credit col).
    const cash = trialColumns(100000 - 0); // debit-positive raw for an asset
    const revenue = trialColumns(0 - 100000); // debit-positive raw for revenue
    const totalDebit = cash.debitMinor + revenue.debitMinor;
    const totalCredit = cash.creditMinor + revenue.creditMinor;
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(100000);
  });
});
