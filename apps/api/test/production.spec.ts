import { describe, expect, it } from 'vitest';
import {
  bomStandardCost,
  operationCostMinor,
  rollUpCost,
  scaledRequiredQty,
} from '../src/modules/production/production.util';

describe('production.util', () => {
  it('scaledRequiredQty scales by batch and rounds up for scrap', () => {
    // BOM yields 10 with 2/unit → 50 units needs 10 of the component.
    expect(scaledRequiredQty(2, 0, 50, 10)).toBe(10);
    // 5% scrap on 10 → 10.5 → ceil 11.
    expect(scaledRequiredQty(2, 5, 50, 10)).toBe(11);
    // fractional base rounds up: 1 per 3, make 10 → 3.33 → 4.
    expect(scaledRequiredQty(1, 0, 10, 3)).toBe(4);
  });

  it('operationCostMinor = minutes × hourly rate', () => {
    expect(operationCostMinor(30, 120_000)).toBe(60_000); // half hour at 1,200.00/h
    expect(operationCostMinor(90, 100_000)).toBe(150_000); // 1.5h at 1,000.00/h
    expect(operationCostMinor(0, 100_000)).toBe(0);
  });

  it('rollUpCost adds overhead and derives unit cost', () => {
    const c = rollUpCost(200_000, 50_000, 10, 5); // overhead 10% of 250,000 = 25,000
    expect(c.overheadMinor).toBe(25_000);
    expect(c.totalMinor).toBe(275_000);
    expect(c.unitMinor).toBe(55_000); // 275,000 / 5
    expect(rollUpCost(100, 0, 0, 0).unitMinor).toBe(0); // no divide-by-zero
  });

  it('bomStandardCost rolls components + operations + overhead per output unit', () => {
    const c = bomStandardCost({
      lines: [
        { quantity: 2, scrapPct: 0, componentCostMinor: 50_000 }, // 100,000
        { quantity: 1, scrapPct: 0, componentCostMinor: 20_000 }, // 20,000
      ],
      operations: [{ runMinutes: 60, ratePerHourMinor: 60_000 }], // 60,000
      overheadPct: 10,
      outputQty: 10,
    });
    expect(c.materialMinor).toBe(120_000);
    expect(c.operationMinor).toBe(60_000);
    expect(c.overheadMinor).toBe(18_000); // 10% of 180,000
    expect(c.totalMinor).toBe(198_000);
    expect(c.unitMinor).toBe(19_800); // 198,000 / 10
  });
});
