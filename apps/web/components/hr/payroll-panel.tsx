'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import type { PayrollRun, Payslip, SalaryComponent } from '@/lib/types';
import type { FeatureModule } from '@/lib/nav';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { DepartmentSalaryAccounts } from './department-salary-accounts';
import { NewSalaryComponentDialog } from './new-salary-component-dialog';
import { RunPayrollDialog } from './run-payroll-dialog';
import { HrStatusBadge, MONTHS } from './hr-ui';

interface CompDraft { name: string; value: string }

export function PayrollPanel() {
  const qc = useQueryClient();
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompDraft>({ name: '', value: '' });
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [openSlip, setOpenSlip] = useState<string | null>(null);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const components = useQuery({ queryKey: ['salary-components'], queryFn: () => apiGet<SalaryComponent[]>('/hr/salary-components') });
  const runs = useQuery({ queryKey: ['payroll-runs'], queryFn: () => apiGet<PayrollRun[]>('/hr/payroll/runs') });
  // The accounts (GL) integration is optional per company — only shown when the Finance module is on.
  const features = useQuery({ queryKey: ['features'], queryFn: () => apiGet<FeatureModule[]>('/tenant/features') });
  const financeOn = (features.data ?? []).some((m) => m.key === 'finance' && m.enabled);
  const payslips = useQuery({
    queryKey: ['payslips', openRun],
    queryFn: () => apiGet<Payslip[]>(`/hr/payroll/runs/${openRun}/payslips`),
    enabled: !!openRun,
  });
  const slip = useQuery({
    queryKey: ['payslip', openSlip],
    queryFn: () => apiGet<Payslip>(`/hr/payslips/${openSlip}`),
    enabled: !!openSlip,
  });

  const updateComp = useMutation({
    mutationFn: ({ c, name, value }: { c: SalaryComponent; name: string; value: string }) =>
      apiPatch(`/hr/salary-components/${c.id}`, c.calc === 'PCT_OF_BASIC'
        ? { name, percent: Number(value) || 0 }
        : { name, valueMinor: Math.round((Number(value) || 0) * 100) }),
    onSuccess: () => { setEditId(null); void qc.invalidateQueries({ queryKey: ['salary-components'] }); },
    onError: onErr,
  });

  const removeComp = useMutation({
    mutationFn: (id: string) => apiDelete(`/hr/salary-components/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['salary-components'] }); },
    onError: onErr,
  });

  const advance = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'pay' }) => apiPatch(`/hr/payroll/runs/${id}/${action}`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['payroll-runs'] }); },
    onError: onErr,
  });

  const startEdit = (c: SalaryComponent) => {
    setEditId(c.id);
    setDraft({ name: c.name, value: c.calc === 'PCT_OF_BASIC' ? String(c.percent) : String(c.valueMinor / 100) });
  };

  const compList = components.data ?? [];
  const runList = runs.data ?? [];

  return (
    <>
      <PaneHeader>
        <div className="ml-auto flex items-center gap-2">
          <NewSalaryComponentDialog />
          <RunPayrollDialog />
        </div>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        {financeOn ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accounts integration <span className="font-normal normal-case text-muted-foreground/70">· optional</span></h3>
            <GlAccountsCard
              title="Payroll → General Ledger"
              description="When set, approving a payroll run posts a journal voucher: Dr salary expense (gross), Cr deductions payable, Cr salaries payable (net). Expense + payable are required to post."
              getPath="/hr/payroll/gl-config"
              putPath="/hr/payroll/gl-config"
              queryKey="hr-payroll-gl-config"
              slots={[
                { key: 'salaryExpenseAccountId', label: 'Salary expense', types: ['EXPENSE'], required: true },
                { key: 'salaryPayableAccountId', label: 'Salaries payable', types: ['LIABILITY'], required: true },
                { key: 'deductionsPayableAccountId', label: 'Deductions payable', types: ['LIABILITY'] },
              ]}
            />
            <div className="mt-3"><DepartmentSalaryAccounts /></div>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Salary components</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Calc</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
              <tbody className="divide-y">
                {compList.map((c) => (
                  <tr key={c.id}>
                    {editId === c.id ? (
                      <>
                        <td className="px-3 py-2"><Input value={draft.name} onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))} className="h-8" /></td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{c.code}</td>
                        <td className="px-3 py-2">{c.type}</td>
                        <td className="px-3 py-2">{c.calc}</td>
                        <td className="px-3 py-2 text-right"><Input type="number" min="0" step="0.01" value={draft.value} onChange={(e) => setDraft((s) => ({ ...s, value: e.target.value }))} className="h-8 w-24 text-right" /></td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" disabled={updateComp.isPending || !draft.name.trim()} onClick={() => updateComp.mutate({ c, name: draft.name, value: draft.value })}><Save className="size-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-medium">{c.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{c.code}</td>
                        <td className="px-3 py-2">{c.type}</td>
                        <td className="px-3 py-2">{c.calc}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.calc === 'FIXED' ? formatMoney(c.valueMinor, 'PKR') : `${c.percent}%`}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(c)}><Pencil className="size-4" /></Button>
                            <Button size="sm" variant="ghost" className="text-destructive" disabled={removeComp.isPending} onClick={() => { if (confirm(`Delete component "${c.name}"?`)) removeComp.mutate(c.id); }}><Trash2 className="size-4" /></Button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {compList.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No components yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payroll runs</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Run #</th><th className="px-3 py-2">Period</th><th className="px-3 py-2 text-right">Staff</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
              <tbody className="divide-y">
                {runList.map((run) => (
                  <tr
                    key={run.id}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => { setOpenRun(openRun === run.id ? null : run.id); setOpenSlip(null); }}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{run.runNo}</td>
                    <td className="px-3 py-2">{MONTHS[run.periodMonth - 1]} {run.periodYear}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{run.employeeCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(run.totalNet.amountMinor, run.totalNet.currency)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <HrStatusBadge status={run.status} />
                        {run.journalVoucherNo ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400" title="Posted to the general ledger">GL · {run.journalVoucherNo}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {run.status === 'DRAFT' ? <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => advance.mutate({ id: run.id, action: 'approve' })}>Approve</Button> : null}
                      {run.status === 'APPROVED' ? <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => advance.mutate({ id: run.id, action: 'pay' })}>Mark paid</Button> : null}
                    </td>
                  </tr>
                ))}
                {runList.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No payroll runs.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {openRun ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payslips</h3>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Payslip #</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2 text-right">Basic</th><th className="px-3 py-2 text-right">Gross</th><th className="px-3 py-2 text-right">Deduction</th><th className="px-3 py-2 text-right">Net</th></tr></thead>
                <tbody className="divide-y">
                  {(payslips.data ?? []).map((p) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setOpenSlip(openSlip === p.id ? null : p.id)}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.payslipNo}</td>
                      <td className="px-3 py-2"><span className="font-medium">{p.employeeName ?? '—'}</span> <span className="font-mono text-xs text-muted-foreground">{p.employeeCode ?? ''}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.basic.amountMinor, p.basic.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.gross.amountMinor, p.gross.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-destructive">{formatMoney(p.deduction.amountMinor, p.deduction.currency)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(p.net.amountMinor, p.net.currency)}</td>
                    </tr>
                  ))}
                  {(payslips.data ?? []).length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No payslips.</td></tr> : null}
                </tbody>
              </table>
            </div>

            {openSlip && slip.data ? (
              <div className="mt-3 overflow-hidden rounded-xl border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payslip {slip.data.payslipNo} · lines</div>
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/20 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                  <tbody className="divide-y">
                    {(slip.data.lines ?? []).map((l) => (
                      <tr key={l.code}>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{l.code}</td>
                        <td className="px-3 py-2">{l.name}</td>
                        <td className="px-3 py-2">{l.type}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.amountMinor, slip.data!.net.currency)}</td>
                      </tr>
                    ))}
                    {(slip.data.lines ?? []).length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No lines.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}
      </PaneBody>
    </>
  );
}
