'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Lock, LockOpen, Plus } from 'lucide-react';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { FiscalPeriod } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { YearEndCloseDialog } from '@/components/finance/year-end-close-dialog';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function PeriodsPage() {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', startDate: '', endDate: '' });

  const { data } = useQuery({ queryKey: ['periods'], queryFn: () => apiGet<FiscalPeriod[]>('/finance/periods') });
  const periods = data ?? [];

  const create = useMutation({
    mutationFn: () => apiPost('/finance/periods', f),
    onSuccess: () => {
      toast.success('Period created', { description: f.name });
      qc.invalidateQueries({ queryKey: ['periods'] });
      setF({ name: '', startDate: '', endDate: '' });
    },
    onError: (e) => toast.error('Could not create period', { description: e instanceof ApiError ? e.message : '' }),
  });

  const toggle = useMutation({
    mutationFn: (p: FiscalPeriod) => apiPatch(`/finance/periods/${p.id}`, { status: p.status === 'OPEN' ? 'CLOSED' : 'OPEN' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['periods'] }),
    onError: (e) => toast.error('Could not update period', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="Fiscal periods — posting is blocked outside an open period." />
      <FinanceTabs />

      <Card className="p-4">
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="name" className="text-xs">Period name</Label>
            <Input id="name" className="w-48" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="FY 2026 — Jun" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sd" className="text-xs">Start</Label>
            <Input id="sd" type="date" className="w-40" value={f.startDate} onChange={(e) => setF((s) => ({ ...s, startDate: e.target.value }))} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ed" className="text-xs">End</Label>
            <Input id="ed" type="date" className="w-40" value={f.endDate} onChange={(e) => setF((s) => ({ ...s, endDate: e.target.value }))} required />
          </div>
          <Button type="submit" disabled={create.isPending}><Plus className="size-4" /> Add period</Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{String(p.startDate).slice(0, 10)}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{String(p.endDate).slice(0, 10)}</TableCell>
                <TableCell><Badge variant={p.status === 'OPEN' ? 'success' : 'secondary'}>{p.status}</Badge></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <YearEndCloseDialog period={p} />
                    <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(p)}>
                      {p.status === 'OPEN' ? <><Lock className="size-4" /> Lock</> : <><LockOpen className="size-4" /> Reopen</>}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {periods.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={CalendarRange} title="No fiscal periods" description="Without periods, posting is always allowed. Add one to enforce period locking." />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
