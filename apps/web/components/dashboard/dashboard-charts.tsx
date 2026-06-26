'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart as AreaIcon, BarChart3, CalendarRange, Download, FileSpreadsheet, FileText, LineChart as LineIcon, PieChart as PieIcon, Sheet, X } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type ReportFormat, downloadReport } from '@/lib/download-report';
import { type ChartType, ReportChart, isChartable } from '@/components/charts/report-chart';
import type { ReportResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';

/** A dashboard chart card backed by a report preset, scoped to a module so it only shows when enabled. */
interface ChartSpec {
  module: string;
  preset: string;
  title: string;
  type: ChartType;
}

const CHARTS: ChartSpec[] = [
  { module: 'crm', preset: 'open-deals-by-stage', title: 'Opportunities by stage', type: 'bar' },
  { module: 'crm', preset: 'leads-by-rating', title: 'Leads by rating', type: 'pie' },
  { module: 'hr', preset: 'employees-by-designation', title: 'Employees by designation', type: 'bar' },
  { module: 'hr', preset: 'leave-by-status', title: 'Leave requests by status', type: 'pie' },
];

const TYPES: { k: ChartType; icon: typeof BarChart3 }[] = [
  { k: 'bar', icon: BarChart3 },
  { k: 'line', icon: LineIcon },
  { k: 'area', icon: AreaIcon },
  { k: 'pie', icon: PieIcon },
];

interface Range {
  from: string;
  to: string;
}

/** Local-date ISO string (YYYY-MM-DD) N days before today. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const QUICK: { label: string; range: () => Range }[] = [
  { label: '30d', range: () => ({ from: isoDaysAgo(30), to: isoToday() }) },
  { label: '90d', range: () => ({ from: isoDaysAgo(90), to: isoToday() }) },
  { label: '1y', range: () => ({ from: isoDaysAgo(365), to: isoToday() }) },
];

function rangeQuery(range: Range): string {
  const qs = new URLSearchParams();
  if (range.from) qs.set('from', range.from);
  if (range.to) qs.set('to', range.to);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

const EXPORTS: { fmt: ReportFormat; label: string; icon: typeof FileText }[] = [
  { fmt: 'pdf', label: 'PDF', icon: FileText },
  { fmt: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  { fmt: 'csv', label: 'CSV', icon: Sheet },
];

function ChartCard({ spec, range, delayMs }: { spec: ChartSpec; range: Range; delayMs: number }) {
  const [type, setType] = useState<ChartType>(spec.type);
  const hasRange = !!(range.from || range.to);
  const path = `/reports/builder/presets/${spec.preset}/run${rangeQuery(range)}`;
  const { data, isLoading } = useQuery({
    queryKey: ['dash-chart', spec.preset, range.from, range.to],
    queryFn: () => apiGet<ReportResult>(path),
    staleTime: 60_000,
  });

  const exportAs = async (fmt: ReportFormat) => {
    try {
      await downloadReport({ method: 'GET', path, title: spec.title }, fmt);
    } catch {
      toast.error('Export failed');
    }
  };

  const empty = !isLoading && !isChartable(data ?? null);
  // With no range active, hide an empty card (dead module). With a range active, keep it and
  // show an empty-state so the filter doesn't make charts silently vanish.
  if (empty && !hasRange) return null;

  return (
    <Card className="glass elevated hover-lift animate-fade-up" style={{ animationDelay: `${delayMs}ms` }}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold">{spec.title}</CardTitle>
        <div className="flex items-center gap-0.5">
          {TYPES.map(({ k, icon: Icon }) => (
            <button
              key={k}
              type="button"
              aria-label={k}
              onClick={() => setType(k)}
              className={cn(
                'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                type === k && 'bg-accent text-foreground',
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Export"
                disabled={empty}
                className="ml-0.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Download className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[8rem]">
              {EXPORTS.map(({ fmt, label, icon: Icon }) => (
                <DropdownMenuItem key={fmt} onSelect={() => exportAs(fmt)}>
                  <Icon className="size-4" /> {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-80 w-full" />
        ) : empty ? (
          <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">No data in this date range.</div>
        ) : (
          <ReportChart report={data} type={type} />
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardCharts({ enabledModules }: { enabledModules: Set<string> }) {
  const [range, setRange] = useState<Range>({ from: '', to: '' });
  const charts = CHARTS.filter((c) => enabledModules.has(c.module));
  if (charts.length === 0) return null;

  const hasRange = !!(range.from || range.to);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Insights</h3>
        <div className="flex flex-wrap items-center gap-2">
          <CalendarRange className="size-4 text-muted-foreground" />
          {QUICK.map((q) => (
            <Button key={q.label} type="button" variant="outline" size="sm" className="h-8 px-2" onClick={() => setRange(q.range())}>
              {q.label}
            </Button>
          ))}
          <Input
            type="date"
            aria-label="From date"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="h-8 w-[9.5rem]"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="To date"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className="h-8 w-[9.5rem]"
          />
          {hasRange ? (
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setRange({ from: '', to: '' })}>
              <X className="size-4" /> Clear
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {charts.map((c, i) => (
          <ChartCard key={`${c.module}-${c.preset}`} spec={c} range={range} delayMs={i * 80} />
        ))}
      </div>
    </div>
  );
}
