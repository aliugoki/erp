/**
 * Finance unit tests (Chunk 3.2). The double-entry balance invariant + money-as-integers are the
 * heart of this module, so they are unit-tested directly. DB integration is in finance-e2e.sh.
 */
import { describe, expect, it } from 'vitest';
import {
  UnbalancedTransactionError,
  assertBalanced,
  computeInvoiceTotals,
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
