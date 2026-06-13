'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlayCircle, Repeat, Zap } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Recurring } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { NewRecurringDialog } from '@/components/finance/new-recurring-dialog';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function RecurringPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['recurring'], queryFn: () => apiGet<Recurring[]>('/finance/recurring') });
  const rows = data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recurring'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
  };
  const run = useMutation({
    mutationFn: (id: string) => apiPost<{ voucherNo: string | null }>(`/finance/recurring/${id}/run`),
    onSuccess: (r) => { toast.success('Voucher generated', { description: r.voucherNo ?? '' }); invalidate(); },
    onError: (e) => toast.error('Run failed', { description: e instanceof ApiError ? e.message : '' }),
  });
  const runDue = useMutation({
    mutationFn: () => apiPost<{ generated: number }>(`/finance/recurring/run-due`),
    onSuccess: (r) => { toast.success(`Generated ${r.generated} due voucher(s)`); invalidate(); },
    onError: (e) => toast.error('Run-due failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader
        title="Finance"
        description="Recurring vouchers — templates that generate a voucher each period."
        action={<div className="flex gap-2">
          <Button variant="outline" disabled={runDue.isPending} onClick={() => runDue.mutate()}><Zap className="size-4" /> Run all due</Button>
          <NewRecurringDialog />
        </div>}
      />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Frequency</TableHead>
              <TableHead>Next run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.description}</TableCell>
                <TableCell><Badge variant="secondary">{r.voucherType}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{r.frequency}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{String(r.nextRunDate).slice(0, 10)}</TableCell>
                <TableCell><Badge variant={r.active ? 'success' : 'secondary'}>{r.active ? 'Active' : 'Ended'}</Badge></TableCell>
                <TableCell className="text-right">
                  {r.active ? (
                    <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(r.id)}>
                      <PlayCircle className="size-4" /> Run now
                    </Button>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Repeat} title="No recurring vouchers" description="Create a template for rent, salaries or subscriptions." action={<NewRecurringDialog />} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
