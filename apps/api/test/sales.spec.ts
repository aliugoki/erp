import { describe, expect, it } from 'vitest';
import { computeTotals, lineTotalMinor, type LineInput } from '../src/modules/sales/sales.util';

describe('sales.util', () => {
  it('lineTotalMinor multiplies qty by unit price (integer minor units)', () => {
    expect(lineTotalMinor(3, 250_000)).toBe(750_000);
    expect(lineTotalMinor(1, 0)).toBe(0);
  });

  it('computeTotals sums lines and applies integer tax', () => {
    const lines: LineInput[] = [
      { description: 'A', quantity: 2, unitPriceMinor: 100_000 }, // 200,000
      { description: 'B', quantity: 1, unitPriceMinor: 50_000 }, // 50,000
    ];
    const t = computeTotals(lines, 10); // subtotal 250,000; tax 25,000; total 275,000
    expect(t.subtotalMinor).toBe(250_000);
    expect(t.taxMinor).toBe(25_000);
    expect(t.totalMinor).toBe(275_000);
  });

  it('computeTotals with zero tax = subtotal, and floors fractional tax', () => {
    const lines: LineInput[] = [{ description: 'A', quantity: 1, unitPriceMinor: 999 }];
    expect(computeTotals(lines, 0).totalMinor).toBe(999);
    expect(computeTotals(lines, 17).taxMinor).toBe(Math.floor((999 * 17) / 100)); // 169
  });
});
