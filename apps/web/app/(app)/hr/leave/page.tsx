'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Clock } from 'lucide-react';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { LeaveRequest, LeaveSummary, LeaveType } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { HrTabs } from '@/components/hr/hr-tabs';
import { NewLeaveRequestDialog } from '@/components/hr/new-leave-request-dialog';
import { NewLeaveTypeDialog } from '@/components/hr/new-leave-type-dialog';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_VARIANT: Record<string, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'destructive', CANCELLED: 'secondary',
};

export default function LeavePage() {
  const qc = useQueryClient();
  const { data: requests } = useQuery({ queryKey: ['leave-requests'], queryFn: () => apiGet<LeaveRequest[]>('/hr/leave-requests') });
  const { data: types } = useQuery({ queryKey: ['leave-types'], queryFn: () => apiGet<LeaveType[]>('/hr/leave-types') });
  const { data: summary } = useQuery({ queryKey: ['leave-summary'], queryFn: () => apiGet<LeaveSummary>('/hr/reports/leave') });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => apiPatch(`/hr/leave-requests/${id}/decide`, { decision }),
    onSuccess: () => {
      for (const k of ['leave-requests', 'leave-summary']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error('Could not update request', { description: e instanceof ApiError ? e.message : '' }),
  });

  const list = requests ?? [];
  const approved = list.filter((r) => r.status === 'APPROVED').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader
        title="Human Resources"
        description="Leave types, balances and the approval workflow."
        action={<div className="flex gap-2"><NewLeaveTypeDialog /><NewLeaveRequestDialog /></div>}
      />
      <HrTabs />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Clock} label="Pending requests" value={summary?.pendingCount ?? 0} accent={summary?.pendingCount ? 'warning' : 'success'} delayMs={0} />
        <StatCard icon={CheckCircle2} label="Approved" value={approved} accent="success" delayMs={60} />
        <StatCard icon={CalendarDays} label="Leave types" value={types?.length ?? 0} accent="primary" delayMs={120} />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Request</TableHead><TableHead>Employee</TableHead><TableHead>Type</TableHead>
              <TableHead>Dates</TableHead><TableHead className="text-right">Days</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.leaveNo}</TableCell>
                <TableCell className="font-medium">{r.employeeName ?? '—'}</TableCell>
                <TableCell>{r.typeName ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge></TableCell>
                <TableCell className="text-right">
                  {r.status === 'PENDING' ? (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'APPROVE' })}>Approve</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'REJECT' })}>Reject</Button>
                    </div>
                  ) : <span className="text-xs text-muted-foreground">{r.decidedAt ? r.decidedAt.slice(0, 10) : '—'}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={CalendarDays} title="No leave requests" description="Define a leave type, then submit a request." action={<NewLeaveRequestDialog />} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
