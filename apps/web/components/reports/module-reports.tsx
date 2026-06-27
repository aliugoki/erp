'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart as AreaIcon, BarChart3, Download, FileSpreadsheet, FileText, LineChart as LineIcon, Loader2, PieChart as PieIcon, Printer, Sheet, Table as TableIcon } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type ReportFormat, downloadReport } from '@/lib/download-report';
import { printReport } from '@/lib/print-report';
import type { ReportPreset, ReportResult } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { type ChartType, ReportChart, isChartable } from '@/components/charts/report-chart';
import { AnalyticsExplorer } from '@/components/analytics/explorer';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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

/**
 * A self-contained per-module reporting surface: preset chips scoped to the module's `sources`, a
 * printable/exportable result (table ⇄ chart), and an embedded custom-analysis Explorer scoped to the
 * same datasets. Backed entirely by the shared report query engine.
 */
export function ModuleReports({ sources }: { sources: string[] }) {
  const presets = useQuery({ queryKey: ['rb-presets'], queryFn: () => apiGet<ReportPreset[]>('/reports/builder/presets') });
  const scoped = (presets.data ?? []).filter((p) => sources.includes(p.source));

  const [active, setActive] = useState<ReportPreset | null>(null);
  const [view, setView] = useState<ChartType | 'table'>('table');
  const path = active ? `/reports/builder/presets/${active.key}/run` : '';
  const run = useQuery({ queryKey: ['module-report', active?.key], queryFn: () => apiGet<ReportResult>(path), enabled: !!active, staleTime: 30_000 });
  const data = run.data ?? null;
  const chartable = isChartable(data);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reports</h3>
        {scoped.length === 0 ? (
          <p className="text-sm text-muted-foreground">No preset reports for this module yet — use custom analysis below.</p>
        ) : (
          <div className="mb-3 flex flex-wrap gap-2">
            {scoped.map((p) => (
              <Button key={p.key} size="sm" variant={active?.key === p.key ? 'default' : 'outline'} onClick={() => { setActive(p); setView('table'); }}>{p.name}</Button>
            ))}
          </div>
        )}

        {active ? (
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
                  onClick={() => data && printReport(active.name, data.columns, data.rows)}><Printer className="size-3.5" /> Print</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8" disabled={!data || !data.rows.length}><Download className="size-3.5" /> Export</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[8rem]">
                    {EXPORTS.map(({ fmt, label, icon: Icon }) => (
                      <DropdownMenuItem key={fmt} onSelect={() => active && downloadReport({ method: 'GET', path, title: active.name }, fmt)}><Icon className="size-4" /> {label}</DropdownMenuItem>
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
        ) : null}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom analysis</h3>
        <AnalyticsExplorer allow={sources} />
      </section>
    </div>
  );
}
