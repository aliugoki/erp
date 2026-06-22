import { Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { type Row, classifyAbc, money } from './pharmacy.util';

/** Date-range filter on a dispense alias `d` (occurred_on); appends params and returns SQL conditions. */
function rangeConds(alias: string, from: string | undefined, to: string | undefined, params: unknown[]): string {
  const conds: string[] = [];
  if (from) conds.push(`${alias}.occurred_on >= $${params.push(from)}`);
  if (to) conds.push(`${alias}.occurred_on <= $${params.push(to)}`);
  return conds.length ? ` AND ${conds.join(' AND ')}` : '';
}

/**
 * Pharmacy analytics — all read-only aggregations over the dispense, lot, drug and register tables.
 * Money is integer minor units; margin = revenue − COGS. Reports power the KPI dashboard, sales /
 * consumption / margin breakdowns, ABC (Pareto) classification, valuation and the expiry buckets.
 */
@Injectable()
export class PharmacyReportsService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  async dashboard() {
    return this.tenantTx.run(async (m) => {
      const drugs = (await m.query(
        `SELECT count(*)::int AS drugs, count(*) FILTER (WHERE controlled)::int AS controlled FROM pharmacy_drug WHERE deleted_at IS NULL`,
      )) as Row[];
      const stock = (await m.query(
        `SELECT COALESCE(SUM(qty_on_hand),0)::bigint AS qty, COALESCE(SUM(qty_on_hand*unit_cost_minor),0)::bigint AS value
         FROM pharmacy_stock_lot WHERE deleted_at IS NULL AND status='ACTIVE'`,
      )) as Row[];
      const exp = (await m.query(
        `SELECT
           COALESCE(SUM(qty_on_hand*unit_cost_minor) FILTER (WHERE expiry_date < current_date),0)::bigint AS expired_value,
           count(*) FILTER (WHERE expiry_date < current_date)::int AS expired_lots,
           COALESCE(SUM(qty_on_hand*unit_cost_minor) FILTER (WHERE expiry_date >= current_date AND expiry_date <= current_date + 90),0)::bigint AS soon_value,
           count(*) FILTER (WHERE expiry_date >= current_date AND expiry_date <= current_date + 90)::int AS soon_lots
         FROM pharmacy_stock_lot WHERE deleted_at IS NULL AND status='ACTIVE' AND qty_on_hand > 0 AND expiry_date IS NOT NULL`,
      )) as Row[];
      const sales = (await m.query(
        `SELECT count(*)::int AS count, COALESCE(SUM(total_minor),0)::bigint AS revenue, COALESCE(SUM(cogs_minor),0)::bigint AS cogs
         FROM pharmacy_dispense WHERE deleted_at IS NULL AND status='COMPLETED'`,
      )) as Row[];
      const r = sales[0]!;
      const revenue = Number(r.revenue);
      const cogs = Number(r.cogs);
      return {
        drugs: Number(drugs[0]!.drugs),
        controlled: Number(drugs[0]!.controlled),
        stockQty: Number(stock[0]!.qty),
        stockValue: money(stock[0]!.value),
        expiredLots: Number(exp[0]!.expired_lots),
        expiredValue: money(exp[0]!.expired_value),
        expiringSoonLots: Number(exp[0]!.soon_lots),
        expiringSoonValue: money(exp[0]!.soon_value),
        dispenses: Number(r.count),
        revenue: money(revenue),
        cogs: money(cogs),
        margin: money(revenue - cogs),
        marginPct: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : 0,
      };
    });
  }

  async sales(from?: string, to?: string) {
    return this.tenantTx.run(async (m) => {
      const params: unknown[] = [];
      const range = rangeConds('d', from, to, params);
      const byType = (await m.query(
        `SELECT d.type, count(*)::int AS count, COALESCE(SUM(d.total_minor),0)::bigint AS revenue, COALESCE(SUM(d.cogs_minor),0)::bigint AS cogs
         FROM pharmacy_dispense d WHERE d.deleted_at IS NULL AND d.status='COMPLETED'${range}
         GROUP BY d.type ORDER BY revenue DESC`,
        params,
      )) as Row[];
      const rows = byType.map((t) => {
        const revenue = Number(t.revenue);
        const cogs = Number(t.cogs);
        return { type: t.type, count: Number(t.count), revenue: money(revenue), cogs: money(cogs), margin: money(revenue - cogs) };
      });
      const totRevenue = rows.reduce((s, r) => s + r.revenue.amountMinor, 0);
      const totCogs = rows.reduce((s, r) => s + r.cogs.amountMinor, 0);
      return {
        byType: rows,
        totals: { count: rows.reduce((s, r) => s + r.count, 0), revenue: money(totRevenue), cogs: money(totCogs), margin: money(totRevenue - totCogs) },
      };
    });
  }

  async consumption(from?: string, to?: string, limit = 20) {
    return this.tenantTx.run(async (m) => {
      const params: unknown[] = [];
      const range = rangeConds('d', from, to, params);
      const lim = params.push(Math.min(Math.max(limit, 1), 200));
      const rows = (await m.query(
        `SELECT i.product_id, p.sku, p.name, SUM(i.qty)::int AS qty,
                COALESCE(SUM(i.line_total_minor),0)::bigint AS revenue, COALESCE(SUM(i.qty*i.unit_cost_minor),0)::bigint AS cogs
         FROM pharmacy_dispense_item i JOIN pharmacy_dispense d ON d.id = i.dispense_id JOIN inventory_product p ON p.id = i.product_id
         WHERE d.deleted_at IS NULL AND d.status='COMPLETED'${range}
         GROUP BY i.product_id, p.sku, p.name ORDER BY qty DESC LIMIT $${lim}`,
        params,
      )) as Row[];
      return rows.map((r) => {
        const revenue = Number(r.revenue);
        const cogs = Number(r.cogs);
        return { productId: r.product_id, sku: r.sku, name: r.name, qty: Number(r.qty), revenue: money(revenue), cogs: money(cogs), margin: money(revenue - cogs) };
      });
    });
  }

  /** Lifetime per-drug revenue vs COGS → margin + margin %. */
  async margin() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT i.product_id, p.sku, p.name, COALESCE(SUM(i.line_total_minor),0)::bigint AS revenue,
                COALESCE(SUM(i.qty*i.unit_cost_minor),0)::bigint AS cogs
         FROM pharmacy_dispense_item i JOIN pharmacy_dispense d ON d.id = i.dispense_id JOIN inventory_product p ON p.id = i.product_id
         WHERE d.deleted_at IS NULL AND d.status='COMPLETED'
         GROUP BY i.product_id, p.sku, p.name ORDER BY (SUM(i.line_total_minor) - SUM(i.qty*i.unit_cost_minor)) DESC`,
      )) as Row[];
      return rows.map((r) => {
        const revenue = Number(r.revenue);
        const cogs = Number(r.cogs);
        return {
          productId: r.product_id, sku: r.sku, name: r.name,
          revenue: money(revenue), cogs: money(cogs), margin: money(revenue - cogs),
          marginPct: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : 0,
        };
      });
    });
  }

  /** ABC (Pareto) classification of drugs by lifetime consumption value. */
  async abc() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT i.product_id, p.sku, p.name, COALESCE(SUM(i.line_total_minor),0)::bigint AS value, SUM(i.qty)::int AS qty
         FROM pharmacy_dispense_item i JOIN pharmacy_dispense d ON d.id = i.dispense_id JOIN inventory_product p ON p.id = i.product_id
         WHERE d.deleted_at IS NULL AND d.status='COMPLETED'
         GROUP BY i.product_id, p.sku, p.name`,
      )) as Row[];
      const meta = new Map(rows.map((r) => [r.product_id as string, { sku: r.sku, name: r.name, qty: Number(r.qty) }]));
      const classified = classifyAbc(rows.map((r) => ({ productId: r.product_id as string, valueMinor: Number(r.value) })));
      const counts = { A: 0, B: 0, C: 0 };
      const items = classified.map((c) => {
        counts[c.abcClass] += 1;
        const md = meta.get(c.productId)!;
        return { productId: c.productId, sku: md.sku, name: md.name, qty: md.qty, value: money(c.valueMinor), cumulativePct: Math.round(c.cumulativePct * 10) / 10, abcClass: c.abcClass };
      });
      return { items, counts };
    });
  }

  /** Current stock value by drug (from active lots). */
  async valuation() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT l.product_id, p.sku, p.name, SUM(l.qty_on_hand)::int AS qty, COALESCE(SUM(l.qty_on_hand*l.unit_cost_minor),0)::bigint AS value
         FROM pharmacy_stock_lot l JOIN inventory_product p ON p.id = l.product_id
         WHERE l.deleted_at IS NULL AND l.status='ACTIVE' AND l.qty_on_hand > 0
         GROUP BY l.product_id, p.sku, p.name ORDER BY value DESC`,
      )) as Row[];
      const lines = rows.map((r) => ({ productId: r.product_id, sku: r.sku, name: r.name, qty: Number(r.qty), value: money(r.value) }));
      return { lines, total: money(lines.reduce((s, l) => s + l.value.amountMinor, 0)) };
    });
  }

  /** Expiry value-at-risk by bucket. */
  async expirySummary() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT
           CASE
             WHEN expiry_date IS NULL THEN 'none'
             WHEN expiry_date < current_date THEN 'expired'
             WHEN expiry_date <= current_date + 30 THEN 'd30'
             WHEN expiry_date <= current_date + 90 THEN 'd90'
             WHEN expiry_date <= current_date + 180 THEN 'd180'
             ELSE 'ok' END AS bucket,
           count(*)::int AS lots, COALESCE(SUM(qty_on_hand*unit_cost_minor),0)::bigint AS value
         FROM pharmacy_stock_lot WHERE deleted_at IS NULL AND status='ACTIVE' AND qty_on_hand > 0
         GROUP BY bucket`,
      )) as Row[];
      const order = ['expired', 'd30', 'd90', 'd180', 'ok', 'none'];
      const label: Record<string, string> = { expired: 'Expired', d30: '≤ 30 days', d90: '31–90 days', d180: '91–180 days', ok: '> 180 days', none: 'No expiry' };
      const byKey = new Map(rows.map((r) => [r.bucket as string, r]));
      return order.map((k) => {
        const r = byKey.get(k);
        return { bucket: k, label: label[k]!, lots: r ? Number(r.lots) : 0, value: money(r ? r.value : 0) };
      });
    });
  }
}
