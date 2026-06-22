'use client';
import { useQuery } from '@tanstack/react-query';
import { Download, TrendingUp, Wallet, AlertTriangle, Layers, Package } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { formatMoney } from '@/lib/utils';
import { DISPENSE_LABEL, Hint, Spinner } from '@/components/pharmacy/pharm-ui';

type M = { amountMinor: number; currency: string };

interface DashboardData {
  drugs: number;
  controlled: number;
  stockQty: number;
  stockValue: M;
  expiredLots: number;
  expiredValue: M;
  expiringSoonLots: number;
  expiringSoonValue: M;
  dispenses: number;
  revenue: M;
  cogs: M;
  margin: M;
  marginPct: number;
}

interface SalesData {
  byType: { type: string; count: number; revenue: M; cogs: M; margin: M }[];
  totals: { count: number; revenue: M; cogs: M; margin: M };
}

interface ConsumptionRow {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  revenue: M;
  cogs: M;
  margin: M;
}

interface AbcData {
  items: { productId: string; sku: string; name: string; qty: number; value: M; cumulativePct: number; abcClass: 'A' | 'B' | 'C' }[];
  counts: { A: number; B: number; C: number };
}

interface ExpiryRow {
  bucket: string;
  label: string;
  lots: number;
  value: M;
}

interface ValuationData {
  lines: { productId: string; sku: string; name: string; qty: number; value: M }[];
  total: M;
}

const fmt = (m: M | undefined) => (m ? formatMoney(m.amountMinor, m.currency) : '—');

export function ReportsDashboard() {
  const dashboard = useQuery({ queryKey: ['pharm-rpt-dashboard'], queryFn: () => apiGet<DashboardData>('/pharmacy/reports/dashboard') });
  const sales = useQuery({ queryKey: ['pharm-rpt-sales'], queryFn: () => apiGet<SalesData>('/pharmacy/reports/sales') });
  const consumption = useQuery({ queryKey: ['pharm-rpt-consumption'], queryFn: () => apiGet<ConsumptionRow[]>('/pharmacy/reports/consumption?limit=10') });
  const abc = useQuery({ queryKey: ['pharm-rpt-abc'], queryFn: () => apiGet<AbcData>('/pharmacy/reports/abc') });
  const expiry = useQuery({ queryKey: ['pharm-rpt-expiry'], queryFn: () => apiGet<ExpiryRow[]>('/pharmacy/reports/expiry-summary') });
  const valuation = useQuery({ queryKey: ['pharm-rpt-valuation'], queryFn: () => apiGet<ValuationData>('/pharmacy/reports/valuation') });

  const d = dashboard.data;

  const exportControlled = async () => {
    try {
      const rows = await apiGet<Array<Record<string, unknown>>>('/pharmacy/reports/controlled');
      if (!rows.length) {
        toast.info('No controlled-substance movements to export');
        return;
      }
      const headers = Object.keys(rows[0]);
      const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [headers.map(quote).join(','), ...rows.map((r) => headers.map((h) => quote(r[h])).join(','))].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'controlled-register.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    }
  };

  return (
    <>
      <PaneHeader>
        <span className="flex-1 text-sm font-medium">Reports &amp; analytics</span>
        <Button size="sm" variant="outline" onClick={exportControlled}>
          <Download className="mr-2 h-4 w-4" /> Controlled register CSV
        </Button>
      </PaneHeader>
      <PaneBody className="p-5 space-y-6">
        {dashboard.isLoading || !d ? <Spinner /> : (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Revenue" value={fmt(d.revenue)} sub={`${d.marginPct}% margin`} icon={TrendingUp} tone="emerald" />
              <Kpi label="Stock value" value={fmt(d.stockValue)} sub={`${d.stockQty} units`} icon={Wallet} />
              <Kpi label="Expiring ≤90d" value={fmt(d.expiringSoonValue)} sub={`${d.expiringSoonLots} lots`} icon={AlertTriangle} tone="amber" />
              <Kpi label="Dispenses" value={String(d.dispenses)} sub={`${d.drugs} drugs`} icon={Package} tone="sky" />
            </div>

            {/* Sales by channel */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Sales by channel</h3>
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Channel</th>
                      <th className="px-3 py-2 text-right font-medium">Count</th>
                      <th className="px-3 py-2 text-right font-medium">Revenue</th>
                      <th className="px-3 py-2 text-right font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(sales.data?.byType ?? []).map((r) => (
                      <tr key={r.type}>
                        <td className="px-3 py-2">{DISPENSE_LABEL[r.type] ?? r.type}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.revenue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.margin)}</td>
                      </tr>
                    ))}
                    {sales.data?.totals ? (
                      <tr className="font-semibold bg-muted/30">
                        <td className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{sales.data.totals.count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(sales.data.totals.revenue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(sales.data.totals.margin)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                {sales.isLoading ? <Spinner /> : (sales.data?.byType ?? []).length === 0 ? <Hint>No sales yet.</Hint> : null}
              </div>
            </section>

            {/* Top consumption */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Top consumption</h3>
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Drug</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(consumption.data ?? []).map((r) => (
                      <tr key={r.productId}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.sku}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {consumption.isLoading ? <Spinner /> : (consumption.data ?? []).length === 0 ? <Hint>No consumption data.</Hint> : null}
              </div>
            </section>

            {/* ABC analysis */}
            <section>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Layers className="h-4 w-4 text-violet-600" /> ABC analysis</h3>
              <div className="mb-2 flex flex-wrap gap-2">
                <Pill tone="emerald">A · {abc.data?.counts.A ?? 0}</Pill>
                <Pill tone="amber">B · {abc.data?.counts.B ?? 0}</Pill>
                <Pill tone="muted">C · {abc.data?.counts.C ?? 0}</Pill>
              </div>
              <div className="divide-y rounded-xl border">
                {abc.isLoading ? <Spinner /> : (abc.data?.items ?? []).length === 0 ? <Hint>No items.</Hint> : (abc.data?.items ?? []).map((r) => (
                  <div key={r.productId} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <Pill tone={r.abcClass === 'A' ? 'emerald' : r.abcClass === 'B' ? 'amber' : 'muted'}>{r.abcClass}</Pill>
                    <span className="w-14 text-right tabular-nums text-muted-foreground">{r.cumulativePct}%</span>
                    <span className="w-28 text-right tabular-nums font-medium">{fmt(r.value)}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Expiry value-at-risk */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Expiry value-at-risk</h3>
              <div className="divide-y rounded-xl border">
                {(() => {
                  const rows = (expiry.data ?? []).filter((r) => r.lots > 0);
                  if (expiry.isLoading) return <Spinner />;
                  if (rows.length === 0) return <Hint>Nothing expiring.</Hint>;
                  return rows.map((r) => {
                    const tone = r.bucket === 'expired' ? 'text-rose-600' : r.bucket === 'd30' ? 'text-amber-600' : '';
                    return (
                      <div key={r.bucket} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className={`font-medium ${tone}`}>{r.label}</span>
                        <span className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{r.lots} lots</span>
                          <span className="w-28 text-right tabular-nums font-medium">{fmt(r.value)}</span>
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>

            {/* Stock valuation */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Stock valuation</h3>
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Drug</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(valuation.data?.lines ?? []).slice(0, 10).map((r) => (
                      <tr key={r.productId}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.sku}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.value)}</td>
                      </tr>
                    ))}
                    {valuation.data?.total ? (
                      <tr className="font-semibold bg-muted/30">
                        <td className="px-3 py-2" colSpan={2}>Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(valuation.data.total)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                {valuation.isLoading ? <Spinner /> : (valuation.data?.lines ?? []).length === 0 ? <Hint>No valued stock.</Hint> : null}
              </div>
            </section>
          </>
        )}
      </PaneBody>
    </>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone = 'default' }: { label: string; value: string; sub: string; icon: typeof Wallet; tone?: 'default' | 'amber' | 'emerald' | 'sky' }) {
  const tones: Record<string, string> = { default: 'text-primary', amber: 'text-amber-600', emerald: 'text-emerald-600', sky: 'text-sky-600' };
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${tones[tone]}`} />
      </div>
      <p className={`mt-2 text-xl font-bold tabular-nums ${tone === 'amber' ? 'text-amber-600' : ''}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function Pill({ tone, children }: { tone: 'emerald' | 'amber' | 'muted'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    muted: 'bg-muted text-muted-foreground',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}
