import { Injectable } from '@nestjs/common';
import { ReportingService } from './reporting.service';

/** A single headline metric for the BI dashboard. `trend` (when present) is a time-ordered series for
 * the sparkline; `deltaPct` is the latest-vs-previous-period change derived from it. */
export interface AnalyticsKpi {
  key: string;
  label: string;
  value: number;
  money: boolean;
  currency?: string;
  deltaPct?: number | null;
  subtitle?: string;
  trend?: number[];
}

/** Latest-vs-previous percentage change for a time-ordered series (null when it can't be computed). */
function latestDeltaPct(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2] ?? 0;
  const last = series[series.length - 1] ?? 0;
  if (prev === 0) return last === 0 ? 0 : null;
  return Math.round(((last - prev) / Math.abs(prev)) * 1000) / 10;
}

/**
 * Analytics: assembles the BI dashboard payload (KPIs + trend + breakdowns) from the existing
 * tenant-scoped reporting read models — one round of cheap indexed reads, no new SQL. Everything is
 * already RLS-scoped by {@link ReportingService}.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly reporting: ReportingService) {}

  async dashboard() {
    const [pl, pipeline, inv, hc] = await Promise.all([
      this.reporting.financeProfitLoss(),
      this.reporting.crmSalesPipeline(),
      this.reporting.inventoryValuation(),
      this.reporting.hrHeadcount(),
    ]);
    const currency = pl.totals.revenue.currency;

    const revTrend = pl.series.map((s) => s.revenue);
    const profitTrend = pl.series.map((s) => s.profit);

    const open = pipeline.raw.filter((r) => r.stage !== 'CLOSED_WON' && r.stage !== 'CLOSED_LOST');
    const openPipeline = open.reduce((s, r) => s + r.total.amountMinor, 0);
    const openDeals = open.reduce((s, r) => s + r.count, 0);
    const won = pipeline.raw.find((r) => r.stage === 'CLOSED_WON');

    const kpis: AnalyticsKpi[] = [
      {
        key: 'revenue',
        label: 'Revenue',
        value: pl.totals.revenue.amountMinor,
        money: true,
        currency,
        deltaPct: latestDeltaPct(revTrend),
        trend: revTrend,
        subtitle: pl.series.length ? `${pl.series.length}-month total` : 'no posted revenue yet',
      },
      {
        key: 'profit',
        label: 'Net profit',
        value: pl.totals.profit.amountMinor,
        money: true,
        currency,
        deltaPct: latestDeltaPct(profitTrend),
        trend: profitTrend,
      },
      {
        key: 'pipeline',
        label: 'Open pipeline',
        value: openPipeline,
        money: true,
        currency,
        subtitle: `${openDeals} open deal${openDeals === 1 ? '' : 's'}`,
      },
      {
        key: 'won',
        label: 'Won revenue',
        value: won?.total.amountMinor ?? 0,
        money: true,
        currency,
        subtitle: `${won?.count ?? 0} closed-won`,
      },
      {
        key: 'inventory',
        label: 'Stock value',
        value: inv.totals.value.amountMinor,
        money: true,
        currency,
        subtitle: `${inv.totals.products} product${inv.totals.products === 1 ? '' : 's'}`,
      },
      {
        key: 'headcount',
        label: 'Headcount',
        value: hc.totals.headcount,
        money: false,
        subtitle: 'active employees',
      },
    ];

    return {
      currency,
      kpis,
      revenueSeries: pl.series, // [{ period, revenue, expense, profit }] (minor units)
      pipeline: pipeline.series, // [{ stage, count, value }]
      inventoryByCategory: inv.series, // [{ category, value }]
      headcountByDept: hc.series, // [{ department, headcount }]
    };
  }
}
