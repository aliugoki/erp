'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart as AreaIcon, BarChart3, Download, FileSpreadsheet, FileText, LineChart as LineIcon, Loader2, PieChart as PieIcon, Printer, Sheet, Table as TableIcon } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type ReportFormat, downloadReport } from '@/lib/download-report';
import { printReport } from '@/lib/print-report';
import type { ReorderLine, ReportPreset, ReportResult, StockReport } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { type ChartType, ReportChart, isChartable } from '@/components/charts/report-chart';
import { AnalyticsExplorer } from '@/components/analytics/explorer';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';

const INV_SOURCES = ['inventory_products', 'product_sales'];
const VIEWS: { k: ChartType | 'table'; icon: typeof BarChart3; label: string }[] = [
  { k: 'table', icon: TableIcon, label: 'Table' },
  { k: 'bar', icon: BarChart3, label: 'Bar' },
  { k: 'line', icon: LineIcon, label: 'Line' },
  { k: 'area', icon: AreaIcon, label: 'Area' },
  { k: 'pie', icon: PieIcon, label: 'Pie' },
];
const EXPORTS: { fmt: ReportFormat; label: string; icon: typeof FileText }[] = [
  { fmt: 'pdf', label: 'PDF', icon: FileText },
  { fmt: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  { fmt: 'csv', label: 'CSV', icon: Sheet },
];

/** Preset-driven, printable inventory reports backed by the report query engine. */
function ReportRunner() {
  const presets = useQuery({ queryKey: ['rb-presets'], queryFn: () => apiGet<ReportPreset[]>('/reports/builder/presets') });
  const invPresets = (presets.data ?? []).filter((p) => INV_SOURCES.includes(p.source));

  const [active, setActive] = useState<ReportPreset | null>(null);
  const [view, setView] = useState<ChartType | 'table'>('table');

  const path = active ? `/reports/builder/presets/${active.key}/run` : '';
  const run = useQuery({
    queryKey: ['inv-report', active?.key],
    queryFn: () => apiGet<ReportResult>(path),
    enabled: !!active,
    staleTime: 30_000,
  });
  const data = run.data ?? null;
  const chartable = isChartable(data);

  const exportAs = async (fmt: ReportFormat) => {
    if (active) await downloadReport({ method: 'GET', path, title: active.name }, fmt);
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reports</h3>
      <div className="mb-3 flex flex-wrap gap-2">
        {invPresets.map((p) => (
          <Button key={p.key} size="sm" variant={active?.key === p.key ? 'default' : 'outline'}
            onClick={() => { setActive(p); setView('table'); }}>
            {p.name}
          </Button>
        ))}
      </div>

      {!active ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Pick a report above to view, print or export it.</p>
      ) : (
        <div className="rounded-xl border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2.5">
            <span className="text-sm font-medium">{active.name}{data ? <span className="ml-2 text-xs text-muted-foreground">{data.rows.length} rows</span> : null}</span>
            <div className="flex items-center gap-2">
              {chartable ? (
                <span className="flex rounded-md border p-0.5">
                  {VIEWS.map((v) => (
                    <button key={v.k} type="button" title={v.label} onClick={() => setView(v.k)}
                      className={cn('flex size-7 items-center justify-center rounded', view === v.k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
                      <v.icon className="size-4" />
                    </button>
                  ))}
                </span>
              ) : null}
              <Button size="sm" variant="outline" className="h-8" disabled={!data || !data.rows.length}
                onClick={() => data && printReport(active.name, data.columns, data.rows)}>
                <Printer className="size-3.5" /> Print
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8" disabled={!data || !data.rows.length}><Download className="size-3.5" /> Export</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[8rem]">
                  {EXPORTS.map(({ fmt, label, icon: Icon }) => (
                    <DropdownMenuItem key={fmt} onSelect={() => exportAs(fmt)}><Icon className="size-4" /> {label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="p-3">
            {run.isLoading || !data ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            ) : data.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No data.</p>
            ) : chartable && view !== 'table' ? (
              <ReportChart report={data} type={view} />
            ) : (
              <div className="max-h-[28rem] overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                    <tr>{data.columns.map((c) => <th key={c.key} className={cn('px-3 py-2', c.money && 'text-right')}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.rows.map((row, i) => (
                      <tr key={i}>
                        {data.columns.map((c) => (
                          <td key={c.key} className={cn('px-3 py-2 tabular-nums', c.money && 'text-right')}>
                            {c.money ? formatMoney(Number(row[c.key] ?? 0), 'PKR') : String(row[c.key] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Inventory reporting: a printable query-engine report runner + a custom explorer, plus the
 * classic stock valuation & reorder views. */
export function InventoryReports() {
  const stock = useQuery({ queryKey: ['stock-report'], queryFn: () => apiGet<StockReport>('/inventory/reports/stock') });
  const reorder = useQuery({ queryKey: ['reorder'], queryFn: () => apiGet<ReorderLine[]>('/inventory/reports/reorder') });

  const s = stock.data;
  const reorderRows = reorder.data ?? [];
  const valuationLabel = useMemo(() => (s ? `${s.totals.items} items · ${formatMoney(s.totals.value.amountMinor, s.totals.value.currency)}` : ''), [s]);

  return (
    <>
      <PaneHeader><span className="font-semibold">Reports</span>{valuationLabel ? <span className="ml-auto text-sm text-muted-foreground">{valuationLabel}</span> : null}</PaneHeader>
      <PaneBody className="space-y-7 p-5">
        <ReportRunner />

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom analysis</h3>
          <AnalyticsExplorer allow={INV_SOURCES} />
        </section>

        {reorderRows.length > 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">Reorder ({reorderRows.length})</h3>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Min</th><th className="px-4 py-2 text-right">Suggested</th></tr></thead>
                <tbody className="divide-y">
                  {reorderRows.map((r) => (
                    <tr key={r.id}><td className="px-4 py-2"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground">{r.sku}</span></td><td className="px-4 py-2 text-right tabular-nums text-amber-600">{r.onHand}</td><td className="px-4 py-2 text-right tabular-nums">{r.minStock}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{r.suggestedQty} {r.unit}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock valuation</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2">Category</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Unit cost</th><th className="px-4 py-2 text-right">Value</th></tr></thead>
              <tbody className="divide-y">
                {(s?.lines ?? []).map((l) => (
                  <tr key={l.id} className={l.belowReorder ? 'bg-amber-50/50' : ''}>
                    <td className="px-4 py-2"><span className="font-medium">{l.name}</span> <span className="text-xs text-muted-foreground">{l.sku}</span></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{l.category ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.onHand} {l.unit}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.unitCost.amountMinor, l.unitCost.currency)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(l.value.amountMinor, l.value.currency)}</td>
                  </tr>
                ))}
                {(s?.lines ?? []).length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No stock yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}
