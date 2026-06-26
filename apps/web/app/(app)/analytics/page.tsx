'use client';
import { type ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BarChart3, Boxes, PieChart as PieIcon, RefreshCw, Users } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { AnalyticsDashboard } from '@/lib/types';
import { type ChartableReport, ReportChart } from '@/components/charts/report-chart';
import { AnalyticsExplorer } from '@/components/analytics/explorer';
import { KpiCard } from '@/components/analytics/kpi-card';
import { RevenueTrendChart } from '@/components/analytics/revenue-trend-chart';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';

function ChartPanel({ title, icon: Icon, children }: { title: string; icon: typeof BarChart3; children: ReactNode }) {
  return (
    <Card className="glass elevated hover-lift animate-fade-up overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Icon className="size-4 text-primary" />
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export default function AnalyticsPage() {
  const qc = useQueryClient();
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn: () => apiGet<AnalyticsDashboard>('/analytics/dashboard'),
    staleTime: 60_000,
  });

  const refresh = useMutation({
    mutationFn: () => apiPost('/reports/refresh'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['analytics-dashboard'] });
      setRefreshedAt(new Date().toLocaleTimeString());
      toast.success('Analytics refreshed');
    },
    onError: (e) => toast.error('Refresh failed', { description: e instanceof ApiError ? e.message : 'You may not have permission to refresh.' }),
  });

  const pipelineReport: ChartableReport = {
    columns: [
      { key: 'stage', label: 'Stage' },
      { key: 'value', label: 'Pipeline value', money: true },
    ],
    rows: (data?.pipeline ?? []).map((p) => ({ stage: p.stage, value: p.value })),
  };
  const inventoryReport: ChartableReport = {
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'value', label: 'Stock value', money: true },
    ],
    rows: (data?.inventoryByCategory ?? []).map((c) => ({ category: c.category, value: c.value })),
  };
  const headcountReport: ChartableReport = {
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'headcount', label: 'Headcount' },
    ],
    rows: (data?.headcountByDept ?? []).map((d) => ({ department: d.department, headcount: d.headcount })),
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title="Analytics" description="Cross-module business intelligence at a glance." />
        <div className="flex items-center gap-3">
          {refreshedAt ? <span className="text-xs text-muted-foreground">Updated {refreshedAt}</span> : null}
          <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw className={refresh.isPending ? 'size-4 animate-spin' : 'size-4'} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {isLoading || !data
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)
          : data.kpis.map((k, i) => <KpiCard key={k.key} kpi={k} delayMs={i * 60} />)}
      </div>

      {/* Interactive explorer — slice any dataset by dimension, measure & filters */}
      <AnalyticsExplorer />

      {/* Hero revenue trend */}
      <ChartPanel title="Revenue, expense & profit" icon={Activity}>
        {isLoading || !data ? <Skeleton className="h-80 w-full" /> : <RevenueTrendChart dashboard={data} />}
      </ChartPanel>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Sales pipeline by stage" icon={BarChart3}>
          {isLoading || !data ? <Skeleton className="h-80 w-full" /> : <ReportChart report={pipelineReport} type="bar" />}
        </ChartPanel>
        <ChartPanel title="Stock value by category" icon={PieIcon}>
          {isLoading || !data ? <Skeleton className="h-80 w-full" /> : <ReportChart report={inventoryReport} type="pie" />}
        </ChartPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Headcount by department" icon={Users}>
          {isLoading || !data ? <Skeleton className="h-80 w-full" /> : <ReportChart report={headcountReport} type="bar" />}
        </ChartPanel>
        <ChartPanel title="Inventory value by category" icon={Boxes}>
          {isLoading || !data ? <Skeleton className="h-80 w-full" /> : <ReportChart report={inventoryReport} type="area" />}
        </ChartPanel>
      </div>
    </div>
  );
}
