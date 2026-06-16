'use client';
import { useQuery } from '@tanstack/react-query';
import { Users, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { HeadcountReport, LeaveSummary, PayrollSummary } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { HrTabs } from '@/components/hr/hr-tabs';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function HrReportsPage() {
  const headcount = useQuery({ queryKey: ['headcount'], queryFn: () => apiGet<HeadcountReport>('/hr/reports/headcount') });
  const payroll = useQuery({ queryKey: ['payroll-summary'], queryFn: () => apiGet<PayrollSummary>('/hr/reports/payroll') });
  const leave = useQuery({ queryKey: ['leave-summary'], queryFn: () => apiGet<LeaveSummary>('/hr/reports/leave') });

  const hc = headcount.data;
  const pr = payroll.data;
  const lv = leave.data;
  const deptMax = Math.max(1, ...(hc?.byDepartment ?? []).map((d) => d.count));

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Human Resources" description="Headcount, payroll and leave at a glance." />
      <HrTabs />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Users} label="Headcount" value={hc?.total ?? 0} accent="primary" delayMs={0} />
        <StatCard
          icon={Wallet}
          label="Latest net payroll"
          value={Math.round((pr?.latest?.totalNet.amountMinor ?? 0) / 100)}
          format={(v) => `${pr?.latest?.totalNet.currency ?? 'PKR'} ${v.toLocaleString()}`}
          accent="success"
          delayMs={70}
        />
        <StatCard icon={Users} label="Pending leave" value={lv?.pendingCount ?? 0} accent={lv?.pendingCount ? 'warning' : 'success'} delayMs={140} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 font-medium">Headcount by department</p>
          <div className="space-y-3">
            {(hc?.byDepartment ?? []).map((d) => (
              <div key={d.department}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{d.department}</span><span className="tabular-nums text-muted-foreground">{d.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(d.count / deptMax) * 100}%` }} />
                </div>
              </div>
            ))}
            {(hc?.byDepartment ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No employees yet.</p> : null}
          </div>
          <div className="mt-4 flex gap-2">
            {(hc?.byStatus ?? []).map((s) => (
              <div key={s.status} className="flex-1 rounded-lg border p-2 text-center">
                <p className="text-lg font-semibold tabular-nums">{s.count}</p>
                <p className="text-xs text-muted-foreground">{s.status.replace('_', ' ').toLowerCase()}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 font-medium">Latest payroll{pr?.latest ? ` — ${MONTHS[pr.latest.periodMonth - 1]} ${pr.latest.periodYear}` : ''}</p>
          {pr?.latest ? (
            <Table>
              <TableHeader><TableRow><TableHead>Component</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {pr.byComponent.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.type}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(c.totalMinor, pr.latest!.totalNet.currency)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Net payout</TableCell><TableCell />
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(pr.latest.totalNet.amountMinor, pr.latest.totalNet.currency)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : <p className="text-sm text-muted-foreground">No payroll runs yet.</p>}

          <p className="mb-2 mt-6 font-medium">Approved leave by type</p>
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Requests</TableHead><TableHead className="text-right">Days</TableHead></TableRow></TableHeader>
            <TableBody>
              {(lv?.byType ?? []).map((t) => (
                <TableRow key={t.name}><TableCell>{t.name}</TableCell><TableCell className="text-right tabular-nums">{t.approvedCount}</TableCell><TableCell className="text-right tabular-nums">{t.approvedDays}</TableCell></TableRow>
              ))}
              {(lv?.byType ?? []).length === 0 ? <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground">No leave types yet.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
