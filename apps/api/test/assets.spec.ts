import { describe, expect, it } from 'vitest';
import { depreciationSchedule, depreciationVoucher, periodDepreciation, salvageFromPct } from '../src/modules/assets/assets.util';

describe('assets.util', () => {
  it('salvageFromPct = pct of cost', () => {
    expect(salvageFromPct(1_000_000, 10)).toBe(100_000);
    expect(salvageFromPct(1_000_000, 0)).toBe(0);
  });

  it('straight-line: flat monthly = (cost − salvage) / life', () => {
    const i = { method: 'STRAIGHT_LINE' as const, costMinor: 1_200_000, salvageMinor: 0, usefulLifeMonths: 12 };
    expect(periodDepreciation({ ...i, bookValueMinor: 1_200_000, monthsElapsed: 0 })).toBe(100_000);
    expect(periodDepreciation({ ...i, bookValueMinor: 200_000, monthsElapsed: 10 })).toBe(100_000);
  });

  it('clamps to salvage and the final period catches up exactly', () => {
    const i = { method: 'STRAIGHT_LINE' as const, costMinor: 1_000_000, salvageMinor: 100_000, usefulLifeMonths: 3 };
    // (1,000,000 − 100,000) / 3 = 300,000 flat; final period absorbs rounding.
    expect(periodDepreciation({ ...i, bookValueMinor: 1_000_000, monthsElapsed: 0 })).toBe(300_000);
    expect(periodDepreciation({ ...i, bookValueMinor: 400_000, monthsElapsed: 2 })).toBe(300_000); // → book value 100,000 (salvage)
    // never below salvage
    expect(periodDepreciation({ ...i, bookValueMinor: 100_000, monthsElapsed: 5 })).toBe(0);
  });

  it('NONE / zero life never depreciates', () => {
    expect(periodDepreciation({ method: 'NONE', costMinor: 1_000_000, salvageMinor: 0, usefulLifeMonths: 12, bookValueMinor: 1_000_000, monthsElapsed: 0 })).toBe(0);
  });

  it('straight-line schedule fully depreciates to salvage over the life', () => {
    const rows = depreciationSchedule({ method: 'STRAIGHT_LINE', costMinor: 1_200_000, salvageMinor: 0, usefulLifeMonths: 12 });
    expect(rows).toHaveLength(12);
    expect(rows[rows.length - 1]!.bookValueMinor).toBe(0);
    expect(rows.reduce((s, r) => s + r.amountMinor, 0)).toBe(1_200_000);
  });

  it('double-declining tapers and still lands exactly on salvage', () => {
    const rows = depreciationSchedule({ method: 'DECLINING_BALANCE', costMinor: 1_000_000, salvageMinor: 100_000, usefulLifeMonths: 10 });
    expect(rows[0]!.amountMinor).toBeGreaterThan(rows[1]!.amountMinor); // tapering
    expect(rows[rows.length - 1]!.bookValueMinor).toBe(100_000); // ends at salvage
    expect(rows.every((r) => r.bookValueMinor >= 100_000)).toBe(true);
  });

  it('depreciationVoucher: balanced Dr expense / Cr accumulated, or null when unconfigured', () => {
    const v = depreciationVoucher({ expenseAccountId: 'exp', accumulatedAccountId: 'acc' }, { runNo: 'DEP-000001', period: '2026-06-30', totalMinor: 100_000 });
    expect(v).not.toBeNull();
    expect(v!.voucherType).toBe('JV');
    expect(v!.occurredOn).toBe('2026-06-30');
    expect(v!.entries).toEqual([
      { accountId: 'exp', debitMinor: 100_000 },
      { accountId: 'acc', creditMinor: 100_000 },
    ]);
    // skips when accounts missing or amount zero
    expect(depreciationVoucher({ expenseAccountId: null, accumulatedAccountId: 'acc' }, { runNo: 'r', period: '2026-06-30', totalMinor: 100_000 })).toBeNull();
    expect(depreciationVoucher({ expenseAccountId: 'exp', accumulatedAccountId: 'acc' }, { runNo: 'r', period: '2026-06-30', totalMinor: 0 })).toBeNull();
  });
});
