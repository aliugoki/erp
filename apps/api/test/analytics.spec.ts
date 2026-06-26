import { describe, expect, it } from 'vitest';
import { AnalyticsService } from '../src/modules/reporting/analytics.service';
import type { ReportingService } from '../src/modules/reporting/reporting.service';

const money = (amountMinor: number, currency = 'PKR') => ({ amountMinor, currency });

/** A ReportingService stub returning fixed read-model shapes. */
function stubReporting(): ReportingService {
  return {
    financeProfitLoss: async () => ({
      raw: [],
      series: [
        { period: '2026-01-01', revenue: 100_00, expense: 60_00, profit: 40_00 },
        { period: '2026-02-01', revenue: 150_00, expense: 90_00, profit: 60_00 },
      ],
      totals: { revenue: money(250_00), expense: money(150_00), profit: money(100_00) },
    }),
    crmSalesPipeline: async () => ({
      raw: [
        { stage: 'QUALIFIED', count: 2, total: money(5000_00) },
        { stage: 'PROPOSAL', count: 1, total: money(3000_00) },
        { stage: 'CLOSED_WON', count: 3, total: money(9000_00) },
        { stage: 'CLOSED_LOST', count: 1, total: money(1000_00) },
      ],
      series: [
        { stage: 'QUALIFIED', count: 2, value: 5000_00 },
        { stage: 'PROPOSAL', count: 1, value: 3000_00 },
      ],
      totals: { deals: 7, value: money(18000_00) },
    }),
    inventoryValuation: async () => ({
      raw: [],
      series: [{ category: 'Widgets', value: 12000_00 }],
      totals: { value: money(12000_00), products: 4 },
    }),
    hrHeadcount: async () => ({
      raw: [],
      series: [{ department: 'Sales', headcount: 9 }],
      totals: { headcount: 9 },
    }),
  } as unknown as ReportingService;
}

describe('AnalyticsService.dashboard', () => {
  it('assembles KPIs, deltas and breakdowns from the read models', async () => {
    const svc = new AnalyticsService(stubReporting());
    const d = await svc.dashboard();

    expect(d.currency).toBe('PKR');
    const byKey = Object.fromEntries(d.kpis.map((k) => [k.key, k]));

    // Revenue: total + latest-vs-previous delta (100 -> 150 = +50%) + sparkline trend.
    expect(byKey.revenue!.value).toBe(250_00);
    expect(byKey.revenue!.deltaPct).toBe(50);
    expect(byKey.revenue!.trend).toEqual([100_00, 150_00]);

    // Open pipeline excludes CLOSED_WON / CLOSED_LOST.
    expect(byKey.pipeline!.value).toBe(5000_00 + 3000_00);
    expect(byKey.pipeline!.subtitle).toContain('3 open deals');

    // Won revenue is the CLOSED_WON bucket.
    expect(byKey.won!.value).toBe(9000_00);

    expect(byKey.inventory!.value).toBe(12000_00);
    expect(byKey.headcount!.value).toBe(9);
    expect(byKey.headcount!.money).toBe(false);

    // Breakdowns pass through.
    expect(d.revenueSeries).toHaveLength(2);
    expect(d.pipeline).toHaveLength(2);
    expect(d.inventoryByCategory[0]!.category).toBe('Widgets');
    expect(d.headcountByDept[0]!.department).toBe('Sales');
  });

  it('returns null delta when there is too little history', async () => {
    const r = stubReporting();
    r.financeProfitLoss = async () => ({
      raw: [],
      series: [{ period: '2026-01-01', revenue: 100_00, expense: 0, profit: 100_00 }],
      totals: { revenue: money(100_00), expense: money(0), profit: money(100_00) },
    });
    const d = await new AnalyticsService(r).dashboard();
    expect(d.kpis.find((k) => k.key === 'revenue')!.deltaPct).toBeNull();
  });
});
