'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart as AreaIcon, BarChart3, LineChart as LineIcon, PieChart as PieIcon } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type ChartType, ReportChart, isChartable } from '@/components/charts/report-chart';
import type { ReportResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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

function ChartCard({ spec, delayMs }: { spec: ChartSpec; delayMs: number }) {
  const [type, setType] = useState<ChartType>(spec.type);
  const { data, isLoading } = useQuery({
    queryKey: ['dash-chart', spec.preset],
    queryFn: () => apiGet<ReportResult>(`/reports/builder/presets/${spec.preset}/run`),
    staleTime: 60_000,
  });

  // Hide the card entirely when the preset has no chartable data (empty module).
  if (!isLoading && !isChartable(data ?? null)) return null;

  return (
    <Card className="animate-fade-up" style={{ animationDelay: `${delayMs}ms` }}>
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
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? <Skeleton className="h-80 w-full" /> : <ReportChart report={data} type={type} />}
      </CardContent>
    </Card>
  );
}

export function DashboardCharts({ enabledModules }: { enabledModules: Set<string> }) {
  const charts = CHARTS.filter((c) => enabledModules.has(c.module));
  if (charts.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Insights</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        {charts.map((c, i) => (
          <ChartCard key={`${c.module}-${c.preset}`} spec={c} delayMs={i * 80} />
        ))}
      </div>
    </div>
  );
}
