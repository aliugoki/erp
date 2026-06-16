import { describe, expect, it } from 'vitest';
import {
  daysToStockout,
  linearForecast,
  riskBand,
  scoreAttrition,
  scoreLead,
  zScoreAnomalies,
} from '../src/modules/ai/ai-insights.util';

describe('ai-insights.util', () => {
  it('linearForecast extrapolates a rising trend', () => {
    const fc = linearForecast([100, 200, 300, 400], 2); // slope 100
    expect(fc).toEqual([500, 600]);
  });

  it('linearForecast floors negative projections at 0', () => {
    const fc = linearForecast([400, 300, 200, 100], 3); // slope -100 → 0,0,0
    expect(fc.every((v) => v >= 0)).toBe(true);
    expect(fc[2]).toBe(0);
  });

  it('zScoreAnomalies flags an outlier and ignores flat/short series', () => {
    const a = zScoreAnomalies([10, 11, 9, 10, 80, 10, 11]);
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a[0]!.value).toBe(80);
    expect(zScoreAnomalies([5, 5, 5, 5])).toEqual([]); // zero variance
    expect(zScoreAnomalies([1, 2])).toEqual([]); // too short
  });

  it('scoreLead rewards rating, value and recency', () => {
    const hot = scoreLead({ rating: 'HOT', estValueMinor: 20_000_000, ageDays: 1 });
    const cold = scoreLead({ rating: 'COLD', estValueMinor: 100_000, ageDays: 40 });
    expect(hot).toBeGreaterThan(cold);
    expect(hot).toBeLessThanOrEqual(100);
    expect(cold).toBeGreaterThanOrEqual(0);
  });

  it('scoreAttrition rises with short tenure and high absence', () => {
    const risky = scoreAttrition({ tenureDays: 60, absenceRate: 0.3, openLeaveDays: 5 });
    const steady = scoreAttrition({ tenureDays: 2000, absenceRate: 0.01, openLeaveDays: 0 });
    expect(risky).toBeGreaterThan(steady);
    expect(riskBand(risky)).toBe('HIGH');
    expect(riskBand(steady)).toBe('LOW');
  });

  it('daysToStockout divides on-hand by demand, null when no demand', () => {
    expect(daysToStockout(100, 5)).toBe(20);
    expect(daysToStockout(100, 0)).toBeNull();
  });
});
