'use client';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { PortfolioRow, TimesheetRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { ProjBadge } from './proj-ui';

function Spinner() {
  return <div className="flex flex-1 items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
}

function PortfolioReport() {
  const q = useQuery({ queryKey: ['project-portfolio'], queryFn: () => apiGet<PortfolioRow[]>('/projects/reports/portfolio') });
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Portfolio</h3>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Project</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Budget</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-right">Billable</th><th className="px-4 py-2 text-right">Remaining</th><th className="px-4 py-2 text-right">Hours</th></tr></thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No projects.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><span className="font-medium">{r.name}</span> <span className="font-mono text-xs text-muted-foreground">{r.projectNo}</span></td>
                  <td className="px-4 py-2"><ProjBadge status={r.status} /></td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.budget.amountMinor, r.budget.currency)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.cost.amountMinor, r.cost.currency)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.billable.amountMinor, r.billable.currency)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${r.remaining.amountMinor < 0 ? 'text-rose-600' : ''}`}>{formatMoney(r.remaining.amountMinor, r.remaining.currency)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.hours}h</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TimesheetReport() {
  const q = useQuery({ queryKey: ['project-timesheet'], queryFn: () => apiGet<TimesheetRow[]>('/projects/reports/timesheet') });
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timesheet</h3>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Employee</th><th className="px-4 py-2 text-right">Hours</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-right">Billable</th></tr></thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No time logged.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-4 py-2">{r.employeeName ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.hours}h</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.cost.amountMinor, r.cost.currency)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.billable.amountMinor, r.billable.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ProjectReports() {
  return (
    <>
      <PaneHeader>
        <span className="font-semibold">Project analytics</span>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <PortfolioReport />
        <TimesheetReport />
      </PaneBody>
    </>
  );
}
