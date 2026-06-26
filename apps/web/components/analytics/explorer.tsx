'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart as AreaIcon,
  BarChart3,
  CalendarRange,
  Compass,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  LineChart as LineIcon,
  PieChart as PieIcon,
  Printer,
  Sheet,
  Table as TableIcon,
  X,
} from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { type ReportFormat, downloadReport } from '@/lib/download-report';
import { printReport } from '@/lib/print-report';
import type { ReportDataset, ReportResult } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { type ChartType, ReportChart, isChartable } from '@/components/charts/report-chart';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const ANY = '__any__';
const AGGS: { k: 'count' | 'sum' | 'avg' | 'min' | 'max'; label: string }[] = [
  { k: 'count', label: 'Count' },
  { k: 'sum', label: 'Total' },
  { k: 'avg', label: 'Average' },
  { k: 'min', label: 'Minimum' },
  { k: 'max', label: 'Maximum' },
];
const VIEWS: { k: ChartType | 'table'; icon: typeof BarChart3; label: string }[] = [
  { k: 'bar', icon: BarChart3, label: 'Bar' },
  { k: 'line', icon: LineIcon, label: 'Line' },
  { k: 'area', icon: AreaIcon, label: 'Area' },
  { k: 'pie', icon: PieIcon, label: 'Pie' },
  { k: 'table', icon: TableIcon, label: 'Table' },
];
const EXPORTS: { fmt: ReportFormat; label: string; icon: typeof FileText }[] = [
  { fmt: 'pdf', label: 'PDF', icon: FileText },
  { fmt: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  { fmt: 'csv', label: 'CSV', icon: Sheet },
];

/** Distinct-value dropdown for one filterable column. */
function FilterSelect({ dataset, column, value, onChange }: { dataset: string; column: string; value: string; onChange: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ['explorer-values', dataset, column],
    queryFn: () => apiGet<string[]>(`/reports/builder/datasets/${dataset}/values?column=${encodeURIComponent(column)}`),
    staleTime: 300_000,
  });
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
      <SelectTrigger className="h-9 capitalize"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>Any</SelectItem>
        {(data ?? []).map((v) => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** `allow` restricts the dataset dropdown to these source keys (e.g. an inventory-only explorer). */
export function AnalyticsExplorer({ allow }: { allow?: string[] } = {}) {
  const datasets = useQuery({ queryKey: ['rb-datasets'], queryFn: () => apiGet<ReportDataset[]>('/reports/builder/datasets') });
  const list = (datasets.data ?? []).filter((d) => !allow || allow.includes(d.key));

  const [source, setSource] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [agg, setAgg] = useState<'count' | 'sum' | 'avg' | 'min' | 'max'>('count');
  const [measure, setMeasure] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [range, setRange] = useState({ from: '', to: '' });
  const [view, setView] = useState<ChartType | 'table'>('bar');

  const ds = list.find((d) => d.key === source);

  // Default to the first dataset, then keep dimension/measure valid as the dataset changes.
  useEffect(() => {
    if (!source && list.length) setSource(list[0]!.key);
  }, [list, source]);
  useEffect(() => {
    if (!ds) return;
    setGroupBy(ds.groupable[0] ?? '');
    setFilters({});
    setAgg('count');
    setMeasure(ds.aggregatable[0] ?? '');
  }, [ds?.key]);

  const colLabel = (key: string) => ds?.columns.find((c) => c.key === key)?.label ?? key;
  const activeFilters = useMemo(
    () => Object.entries(filters).filter(([, v]) => v).map(([column, value]) => ({ column, value })),
    [filters],
  );
  const hasRange = !!(range.from || range.to);

  const body = useMemo(
    () => ({
      source,
      columns: [],
      groupBy,
      agg,
      measure: agg === 'count' ? undefined : measure,
      filters: activeFilters,
      dateFrom: range.from || undefined,
      dateTo: range.to || undefined,
    }),
    [source, groupBy, agg, measure, activeFilters, range],
  );

  const canRun = !!source && !!groupBy && (agg === 'count' || !!measure);
  const result = useQuery({
    queryKey: ['explorer-run', body],
    queryFn: () => apiPost<ReportResult>('/reports/builder/run', body),
    enabled: canRun,
    staleTime: 30_000,
  });
  const data = result.data ?? null;
  const chartable = isChartable(data);

  const exportAs = async (fmt: ReportFormat) => {
    try {
      await downloadReport({ method: 'POST', path: '/reports/builder/run', body, title: `${ds?.label ?? 'analysis'} by ${colLabel(groupBy)}` }, fmt);
    } catch {
      toast.error('Export failed');
    }
  };

  return (
    <Card className="glass elevated animate-fade-up overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Compass className="size-4 text-primary" />
        <p className="text-sm font-semibold">Explore</p>
        <span className="text-xs text-muted-foreground">Slice any dataset by dimension, measure & filters</span>
      </div>

      {/* Controls */}
      <div className="grid gap-3 border-b border-border/60 p-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Dataset</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select dataset" /></SelectTrigger>
            <SelectContent>{list.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Group by</Label>
          <Select value={groupBy} onValueChange={setGroupBy} disabled={!ds?.groupable.length}>
            <SelectTrigger className="h-9"><SelectValue placeholder={ds?.groupable.length ? 'Dimension' : 'No dimensions'} /></SelectTrigger>
            <SelectContent>{(ds?.groupable ?? []).map((g) => <SelectItem key={g} value={g}>{colLabel(g)}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Measure</Label>
          <Select value={agg} onValueChange={(v) => setAgg(v as typeof agg)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AGGS.map((a) => <SelectItem key={a.k} value={a.k} disabled={a.k !== 'count' && !ds?.aggregatable.length}>{a.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{agg === 'count' ? 'Of' : 'Measure column'}</Label>
          <Select value={agg === 'count' ? '' : measure} onValueChange={setMeasure} disabled={agg === 'count' || !ds?.aggregatable.length}>
            <SelectTrigger className="h-9"><SelectValue placeholder={agg === 'count' ? 'Records' : 'Column'} /></SelectTrigger>
            <SelectContent>{(ds?.aggregatable ?? []).map((m) => <SelectItem key={m} value={m}>{colLabel(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Filters + date range */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border/60 bg-muted/30 p-4">
        <span className="flex items-center gap-1.5 self-center text-xs font-medium text-muted-foreground"><Filter className="size-3.5" /> Filters</span>
        {(ds?.filterable ?? []).map((col) => (
          <div key={col} className="space-y-1.5">
            <Label className="text-xs capitalize">{colLabel(col)}</Label>
            <div className="w-40">
              <FilterSelect dataset={source} column={col} value={filters[col] ?? ''} onChange={(v) => setFilters((f) => ({ ...f, [col]: v }))} />
            </div>
          </div>
        ))}
        {(ds?.filterable.length ?? 0) === 0 ? <span className="self-center text-xs text-muted-foreground/70">No filters for this dataset</span> : null}

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1 text-xs"><CalendarRange className="size-3.5" /> From</Label>
          <Input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-9 w-[9.5rem]" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 w-[9.5rem]" />
        </div>
        {(activeFilters.length > 0 || hasRange) ? (
          <Button variant="ghost" size="sm" className="h-9 self-end" onClick={() => { setFilters({}); setRange({ from: '', to: '' }); }}>
            <X className="size-4" /> Reset
          </Button>
        ) : null}
      </div>

      {/* Toolbar: view toggle + export */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="flex rounded-md border p-0.5">
          {VIEWS.map((v) => (
            <button key={v.k} type="button" title={v.label} onClick={() => setView(v.k)}
              className={cn('flex size-7 items-center justify-center rounded', view === v.k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
              <v.icon className="size-4" />
            </button>
          ))}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" disabled={!data || !data.rows.length}
            onClick={() => data && printReport(`${ds?.label ?? 'Analysis'} by ${colLabel(groupBy)}`, data.columns, data.rows)}>
            <Printer className="size-3.5" /> Print
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8" disabled={!chartable && !(data && data.rows.length)}>
                <Download className="size-3.5" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[8rem]">
              {EXPORTS.map(({ fmt, label, icon: Icon }) => (
                <DropdownMenuItem key={fmt} onSelect={() => exportAs(fmt)}><Icon className="size-4" /> {label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Result */}
      <div className="p-4">
        {result.isLoading || !canRun ? (
          <Skeleton className="h-80 w-full" />
        ) : result.isError ? (
          <div className="flex h-80 items-center justify-center text-sm text-destructive">
            {result.error instanceof ApiError ? result.error.message : 'Analysis failed.'}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">No data for this selection.</div>
        ) : view !== 'table' && chartable ? (
          <ReportChart report={data} type={view} />
        ) : (
          <div className="max-h-80 overflow-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow>{data.columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {data.rows.map((row, i) => (
                  <TableRow key={i}>
                    {data.columns.map((c) => (
                      <TableCell key={c.key} className="tabular-nums">
                        {c.money ? formatMoney(Number(row[c.key] ?? 0), 'PKR') : String(row[c.key] ?? '—')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  );
}
