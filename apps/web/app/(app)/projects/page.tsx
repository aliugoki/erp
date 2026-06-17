'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, FolderKanban, Layers, TrendingUp, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { PortfolioRow, Project, TimesheetRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { NewProjectDialog } from '@/components/projects/new-project-dialog';
import { ProjectDetailDialog } from '@/components/projects/project-detail-dialog';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';

const TABS = ['portfolio', 'timesheets'] as const;
type Tab = (typeof TABS)[number];
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PLANNED: 'outline', ACTIVE: 'default', ON_HOLD: 'secondary', COMPLETED: 'secondary', CANCELLED: 'destructive',
};

export default function ProjectsPage() {
  const [tab, setTab] = useState<Tab>('portfolio');
  const [openProject, setOpenProject] = useState<string | null>(null);

  const projects = useQuery({ queryKey: ['projects'], queryFn: () => apiGet<Project[]>('/projects') });
  const portfolio = useQuery({ queryKey: ['project-portfolio'], queryFn: () => apiGet<PortfolioRow[]>('/projects/reports/portfolio') });
  const timesheet = useQuery({ queryKey: ['project-timesheet'], queryFn: () => apiGet<TimesheetRow[]>('/projects/reports/timesheet') });

  const rows = portfolio.data ?? [];
  const active = (projects.data ?? []).filter((p) => p.status === 'ACTIVE').length;
  const currency = rows[0]?.budget.currency ?? 'PKR';
  const billable = rows.reduce((s, r) => s + r.billable.amountMinor, 0);
  const overBudget = rows.filter((r) => r.remaining.amountMinor < 0).length;
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Projects" description="Projects, tasks, timesheets, and cost-vs-budget tracking." action={<NewProjectDialog />} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FolderKanban} label="Active projects" value={active} accent="primary" delayMs={0} />
        <StatCard icon={Wallet} label="Billable to date" value={billable} format={(v) => formatMoney(v, currency)} accent="success" delayMs={60} />
        <StatCard icon={Clock} label="Approved hours" value={totalHours} format={(v) => `${Math.round(v * 10) / 10}h`} accent="primary" delayMs={120} />
        <StatCard icon={TrendingUp} label="Over budget" value={overBudget} accent="destructive" delayMs={180} />
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{t}</button>
        ))}
      </div>

      {tab === 'portfolio' ? (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Project</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Budget</th><th className="px-4 py-2">Cost</th><th className="px-4 py-2">Billable</th><th className="px-4 py-2">Remaining</th><th className="px-4 py-2">Hours</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Layers className="mx-auto mb-2 h-5 w-5" />No projects yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpenProject(r.id)}>
                  <td className="px-4 py-2"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground">{r.projectNo}</span></td>
                  <td className="px-4 py-2"><Badge variant={STATUS_VARIANT[r.status] ?? 'outline'}>{r.status}</Badge></td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(r.budget.amountMinor, r.budget.currency)}</td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(r.cost.amountMinor, r.cost.currency)}</td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(r.billable.amountMinor, r.billable.currency)}</td>
                  <td className={`px-4 py-2 tabular-nums ${r.remaining.amountMinor < 0 ? 'text-destructive' : ''}`}>{formatMoney(r.remaining.amountMinor, r.remaining.currency)}</td>
                  <td className="px-4 py-2 tabular-nums">{r.hours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'timesheets' ? (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Employee</th><th className="px-4 py-2">Approved hours</th><th className="px-4 py-2">Cost</th><th className="px-4 py-2">Billable</th></tr>
            </thead>
            <tbody>
              {(timesheet.data ?? []).length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground"><Clock className="mx-auto mb-2 h-5 w-5" />No approved time yet.</td></tr>
              ) : (timesheet.data ?? []).map((r) => (
                <tr key={r.employeeId} className="border-t">
                  <td className="px-4 py-2 font-medium">{r.employeeName}</td>
                  <td className="px-4 py-2 tabular-nums">{r.hours}h</td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(r.cost.amountMinor, r.cost.currency)}</td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(r.billable.amountMinor, r.billable.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ProjectDetailDialog projectId={openProject} open={!!openProject} onOpenChange={(v) => !v && setOpenProject(null)} />
    </div>
  );
}
