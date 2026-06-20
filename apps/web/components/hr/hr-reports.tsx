'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { HeadcountReport, LeaveSummary, PayrollSummary } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { MONTHS } from './hr-ui';

export function HrReports() {
  const headcount = useQuery({ queryKey: ['headcount'], queryFn: () => apiGet<HeadcountReport>('/hr/reports/headcount') });
  const payroll = useQuery({ queryKey: ['payroll-summary'], queryFn: () => apiGet<PayrollSummary>('/hr/reports/payroll') });
  const leave = useQuery({ queryKey: ['leave-summary'], queryFn: () => apiGet<LeaveSummary>('/hr/reports/leave') });

  const hc = headcount.data;
  const pr = payroll.data;
  const lv = leave.data;
  const deptMax = Math.max(1, ...(hc?.byDepartment ?? []).map((d) => d.count));

  return (
    <>
      <PaneHeader>
        <span className="font-semibold">HR reports</span>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Headcount</h3>
          <div className="rounded-xl border p-4">
            <p className="text-3xl font-semibold tabular-nums">{hc?.total ?? 0}</p>
            <p className="text-xs text-muted-foreground">total employees</p>
            <div className="mt-4 space-y-3">
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
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Latest payroll{pr?.latest ? ` — ${MONTHS[pr.latest.periodMonth - 1]} ${pr.latest.periodYear}` : ''}
          </h3>
          <div className="overflow-hidden rounded-xl border">
            {pr?.latest ? (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Component</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
                <tbody className="divide-y">
                  {pr.byComponent.map((c) => (
                    <tr key={c.name}>
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.type}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(c.totalMinor, 'PKR')}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2">
                    <td className="px-3 py-2 font-semibold">Net payout</td><td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(pr.latest.totalNet.amountMinor, pr.latest.totalNet.currency)}</td>
                  </tr>
                </tbody>
              </table>
            ) : <p className="px-3 py-6 text-center text-sm text-muted-foreground">No payroll runs yet.</p>}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Leave{lv?.pendingCount ? ` — ${lv.pendingCount} pending` : ' — none pending'}
          </h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Requests</th><th className="px-3 py-2 text-right">Days</th></tr></thead>
              <tbody className="divide-y">
                {(lv?.byType ?? []).map((t) => (
                  <tr key={t.name}>
                    <td className="px-3 py-2">{t.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.approvedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.approvedDays}</td>
                  </tr>
                ))}
                {(lv?.byType ?? []).length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No leave types yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}
