import { Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import {
  type Anomaly,
  daysToStockout,
  linearForecast,
  riskBand,
  scoreAttrition,
  scoreLead,
  zScoreAnomalies,
} from './ai-insights.util';

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);

/** AI Insights — module-level intelligence computed from the tenant's own data (RLS-scoped): a
 * least-squares sales forecast, lead scoring, inventory demand/stockout prediction, employee
 * attrition risk and consumption-anomaly detection. Pure maths live in ai-insights.util.ts. */
@Injectable()
export class AiInsightsService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  /** Monthly won-deal value history + a 3-month least-squares forecast. */
  async salesForecast() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT to_char(COALESCE(closed_at, updated_at), 'YYYY-MM') AS month,
                COALESCE(sum(value_minor),0)::bigint AS total, min(currency) AS currency
         FROM crm_deal
         WHERE deleted_at IS NULL AND stage='CLOSED_WON'
         GROUP BY month ORDER BY month`,
      )) as Row[];
      const currency = (rows.find((r) => r.currency)?.currency as string) ?? 'PKR';
      const history = rows.map((r) => ({ month: r.month as string, valueMinor: num(r.total) }));
      const forecast = linearForecast(history.map((h) => h.valueMinor), 3);
      return { currency, history, forecastMinor: forecast };
    });
  }

  /** Score open leads 0–100 (rating × value × recency), hottest first. */
  async leadScores() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, company, rating, est_value_minor, currency,
                EXTRACT(EPOCH FROM (now() - created_at)) / 86400 AS age_days
         FROM crm_lead
         WHERE deleted_at IS NULL AND status NOT IN ('CONVERTED','UNQUALIFIED')`,
      )) as Row[];
      return rows
        .map((r) => {
          const score = scoreLead({ rating: r.rating as string, estValueMinor: num(r.est_value_minor), ageDays: num(r.age_days) });
          return {
            id: r.id as string,
            name: r.name as string,
            company: (r.company as string) ?? null,
            rating: r.rating as string,
            estValue: { amountMinor: num(r.est_value_minor), currency: (r.currency as string) ?? 'PKR' },
            score,
            band: riskBand(score),
          };
        })
        .sort((a, b) => b.score - a.score);
    });
  }

  /** Per-product demand from the last 90 days of ledger out-movements: avg daily demand, days to
   * stockout and a 30-day forecast; flags reorder when stockout is within two weeks. */
  async inventoryDemand() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT p.id, p.sku, p.name, p.on_hand,
                COALESCE(sum(l.qty_out),0)::int AS out90
         FROM inventory_product p
         LEFT JOIN inventory_ledger l ON l.product_id = p.id AND l.deleted_at IS NULL
              AND l.created_at > now() - interval '90 days'
         WHERE p.deleted_at IS NULL
         GROUP BY p.id, p.sku, p.name, p.on_hand`,
      )) as Row[];
      return rows
        .map((r) => {
          const avgDaily = num(r.out90) / 90;
          const stockoutDays = daysToStockout(num(r.on_hand), avgDaily);
          return {
            id: r.id as string,
            sku: r.sku as string,
            name: r.name as string,
            onHand: num(r.on_hand),
            avgDailyDemand: Math.round(avgDaily * 100) / 100,
            forecast30: Math.round(avgDaily * 30),
            daysToStockout: stockoutDays,
            reorder: stockoutDays !== null && stockoutDays < 14,
          };
        })
        .sort((a, b) => (a.daysToStockout ?? 1e9) - (b.daysToStockout ?? 1e9));
    });
  }

  /** Attrition risk per active employee from tenure, recent absence rate and pending-leave pressure. */
  async attritionRisk() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT e.id, e.first_name, e.last_name,
                EXTRACT(EPOCH FROM (now() - COALESCE(e.join_date::timestamptz, e.created_at))) / 86400 AS tenure_days,
                count(a.*) FILTER (WHERE a.status='ABSENT')::int AS absent,
                count(a.*)::int AS logged,
                (SELECT COALESCE(sum(r.days),0) FROM hr_leave_request r
                  WHERE r.employee_id = e.id AND r.status='PENDING' AND r.deleted_at IS NULL) AS open_leave
         FROM hr_employee e
         LEFT JOIN hr_attendance a ON a.employee_id = e.id AND a.deleted_at IS NULL
              AND a.date > (now() - interval '90 days')::date
         WHERE e.deleted_at IS NULL AND e.status='ACTIVE'
         GROUP BY e.id, e.first_name, e.last_name, e.join_date, e.created_at`,
      )) as Row[];
      return rows
        .map((r) => {
          const logged = num(r.logged);
          const absenceRate = logged > 0 ? num(r.absent) / logged : 0;
          const score = scoreAttrition({ tenureDays: num(r.tenure_days), absenceRate, openLeaveDays: num(r.open_leave) });
          return {
            employeeId: r.id as string,
            employeeName: [r.first_name, r.last_name].filter(Boolean).join(' '),
            tenureDays: Math.round(num(r.tenure_days)),
            absenceRatePct: Math.round(absenceRate * 100),
            score,
            band: riskBand(score),
          };
        })
        .sort((a, b) => b.score - a.score);
    });
  }

  /** Z-score anomaly detection over monthly inventory consumption value (unusual spend months). */
  async anomalies() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT to_char(created_at, 'YYYY-MM') AS month, COALESCE(sum(value_out_minor),0)::bigint AS total
         FROM inventory_ledger WHERE deleted_at IS NULL GROUP BY month ORDER BY month`,
      )) as Row[];
      const series = rows.map((r) => ({ month: r.month as string, valueMinor: num(r.total) }));
      const flagged: Array<Anomaly & { month: string }> = zScoreAnomalies(series.map((s) => s.valueMinor)).map((a) => ({
        ...a,
        month: series[a.index]!.month,
      }));
      return { series, anomalies: flagged };
    });
  }

  /** Headline numbers for the AI dashboard. */
  async summary() {
    const [sales, leads, demand, attrition] = await Promise.all([
      this.salesForecast(),
      this.leadScores(),
      this.inventoryDemand(),
      this.attritionRisk(),
    ]);
    return {
      nextMonthSales: { amountMinor: sales.forecastMinor[0] ?? 0, currency: sales.currency },
      hotLeads: leads.filter((l) => l.band === 'HIGH').length,
      reorderProducts: demand.filter((d) => d.reorder).length,
      atRiskEmployees: attrition.filter((a) => a.band === 'HIGH').length,
    };
  }
}
