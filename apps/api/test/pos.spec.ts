import { describe, expect, it } from 'vitest';
import {
  type PosLineInput,
  changeMinor,
  computeLine,
  computeSaleTotals,
  expectedCashMinor,
  simulateTerminalCharge,
  varianceMinor,
} from '../src/modules/pos/pos.util';

describe('pos.util', () => {
  it('computeLine: gross, clamped discount, integer tax on post-discount amount', () => {
    const l = computeLine({ description: 'Widget', quantity: 3, unitPriceMinor: 100_000, discountMinor: 50_000, taxRate: 10 });
    // gross 300,000; discount 50,000; taxable 250,000; tax floor(25,000)=25,000; total 275,000
    expect(l.grossMinor).toBe(300_000);
    expect(l.discountMinor).toBe(50_000);
    expect(l.taxMinor).toBe(25_000);
    expect(l.lineTotalMinor).toBe(275_000);
  });

  it('computeLine: discount cannot exceed the line gross', () => {
    const l = computeLine({ description: 'A', quantity: 1, unitPriceMinor: 1_000, discountMinor: 9_999 });
    expect(l.discountMinor).toBe(1_000);
    expect(l.lineTotalMinor).toBe(0);
  });

  it('computeSaleTotals: sums lines, folds line + order discounts, sums per-line tax', () => {
    const lines: PosLineInput[] = [
      { description: 'A', quantity: 2, unitPriceMinor: 100_000, taxRate: 10 }, // gross 200,000 tax 20,000
      { description: 'B', quantity: 1, unitPriceMinor: 50_000, discountMinor: 10_000 }, // gross 50,000 disc 10,000
    ];
    const t = computeSaleTotals(lines, 5_000); // order discount 5,000
    expect(t.subtotalMinor).toBe(250_000);
    expect(t.discountMinor).toBe(15_000); // 10,000 line + 5,000 order
    expect(t.taxMinor).toBe(20_000);
    expect(t.totalMinor).toBe(255_000); // 250,000 - 15,000 + 20,000
  });

  it('computeSaleTotals: order discount is clamped to the post-line-discount subtotal', () => {
    const lines: PosLineInput[] = [{ description: 'A', quantity: 1, unitPriceMinor: 10_000 }];
    const t = computeSaleTotals(lines, 999_999);
    expect(t.discountMinor).toBe(10_000);
    expect(t.totalMinor).toBe(0);
  });

  it('changeMinor: never negative; returns overpayment', () => {
    expect(changeMinor(120_000, 100_000)).toBe(20_000);
    expect(changeMinor(90_000, 100_000)).toBe(0);
  });

  it('expectedCash + variance: drawer reconciliation', () => {
    // float 50,000 + cash sales 200,000 - (change 15,000 + refunds 10,000) = 225,000 expected
    const expected = expectedCashMinor(50_000, 200_000, 15_000 + 10_000);
    expect(expected).toBe(225_000);
    expect(varianceMinor(224_000, expected)).toBe(-1_000); // short by 1,000
    expect(varianceMinor(225_000, expected)).toBe(0);
  });

  it('simulateTerminalCharge: deterministic approval with scheme + 4-digit last4', () => {
    const a = simulateTerminalCharge('SALE-000123', 275_000);
    const b = simulateTerminalCharge('SALE-000123', 275_000);
    expect(a).toEqual(b); // deterministic — no randomness
    expect(a.status).toBe('APPROVED');
    expect(a.reference).toMatch(/^SIM\d{6}$/);
    expect(a.last4).toMatch(/^\d{4}$/);
    expect(['VISA', 'MASTERCARD', 'AMEX', 'UNIONPAY']).toContain(a.scheme);
    // different inputs generally diverge
    expect(simulateTerminalCharge('SALE-000124', 275_000).reference).not.toBe(a.reference);
  });
});
