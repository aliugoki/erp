'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { Payslip, PayrollRun, SalaryComponent } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { HrTabs } from '@/components/hr/hr-tabs';
import { NewSalaryComponentDialog } from '@/components/hr/new-salary-component-dialog';
import { RunPayrollDialog } from '@/components/hr/run-payroll-dialog';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RUN_VARIANT: Record<string, 'secondary' | 'warning' | 'success'> = { DRAFT: 'warning', APPROVED: 'success', PAID: 'success' };

export default function PayrollPage() {
  const qc = useQueryClient();
  const [openRun, setOpenRun] = useState<string | null>(null);
  const { data: components } = useQuery({ queryKey: ['salary-components'], queryFn: () => apiGet<SalaryComponent[]>('/hr/salary-components') });
  const { data: runs } = useQuery({ queryKey: ['payroll-runs'], queryFn: () => apiGet<PayrollRun[]>('/hr/payroll/runs') });
  const { data: payslips } = useQuery({
    queryKey: ['payslips', openRun],
    queryFn: () => apiGet<Payslip[]>(`/hr/payroll/runs/${openRun}/payslips`),
    enabled: !!openRun,
  });

  const advance = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'pay' }) => apiPatch(`/hr/payroll/runs/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-runs'] }),
    onError: (e) => toast.error('Could not update run', { description: e instanceof ApiError ? e.message : '' }),
  });

  const runList = runs ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader
        title="Human Resources"
        description="Salary components and monthly payroll runs."
        action={<div className="flex gap-2"><NewSalaryComponentDialog /><RunPayrollDialog /></div>}
      />
      <HrTabs />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-1">
          <p className="mb-3 font-medium">Salary components</p>
          {(components ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">No components yet</p>
          ) : (
            <ul className="space-y-2">
              {(components ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span><span className="font-medium">{c.name}</span> <span className="font-mono text-xs text-muted-foreground">{c.code}</span></span>
                  <span className="flex items-center gap-2">
                    <Badge variant={c.type === 'EARNING' ? 'success' : 'destructive'} className="text-[10px]">{c.type === 'EARNING' ? '+' : '−'}</Badge>
                    <span className="tabular-nums text-muted-foreground">{c.calc === 'PCT_OF_BASIC' ? `${c.percent}%` : formatMoney(c.valueMinor, 'PKR')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <div className="border-b p-4"><p className="font-medium">Payroll runs</p></div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Run</TableHead><TableHead>Period</TableHead><TableHead className="text-right">Staff</TableHead><TableHead className="text-right">Net</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {runList.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.runNo}</TableCell>
                  <TableCell>{MONTHS[r.periodMonth - 1]} {r.periodYear}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.employeeCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.totalNet.amountMinor, r.totalNet.currency)}</TableCell>
                  <TableCell><Badge variant={RUN_VARIANT[r.status] ?? 'secondary'}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge></TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {r.status === 'DRAFT' ? <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => advance.mutate({ id: r.id, action: 'approve' })}>Approve</Button> : null}
                    {r.status === 'APPROVED' ? <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => advance.mutate({ id: r.id, action: 'pay' })}>Mark paid</Button> : null}
                    {r.status === 'PAID' ? <span className="text-xs text-muted-foreground">Paid</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {runList.length === 0 ? (
            <div className="p-4"><EmptyState icon={Wallet} title="No payroll runs" description="Add components, then run payroll for a month." action={<RunPayrollDialog />} /></div>
          ) : null}
        </Card>
      </div>

      {openRun ? (
        <Card className="overflow-hidden">
          <div className="border-b p-4"><p className="font-medium">Payslips</p></div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Payslip</TableHead><TableHead>Employee</TableHead><TableHead className="text-right">Basic</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Net</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(payslips ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.payslipNo}</TableCell>
                  <TableCell className="font-medium">{p.employeeName ?? p.employeeCode ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.basic.amountMinor, p.basic.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.gross.amountMinor, p.gross.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{formatMoney(p.deduction.amountMinor, p.deduction.currency)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(p.net.amountMinor, p.net.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
