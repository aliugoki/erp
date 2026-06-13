'use client';
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, NotebookPen, RotateCcw } from 'lucide-react';
import { ApiError, apiList, apiPost } from '@/lib/api';
import type { JournalTxn } from '@/lib/types';
import { VOUCHER_TYPES } from '@/lib/finance';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { NewJournalDialog } from '@/components/finance/new-journal-dialog';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function JournalPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [vtype, setVtype] = useState('ALL');
  const pageSize = 10;

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (vtype !== 'ALL') params.set('voucherType', vtype);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['transactions', vtype, page],
    queryFn: () => apiList<JournalTxn>(`/finance/transactions?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const reverse = useMutation({
    mutationFn: (id: string) => apiPost<{ voucherNo: string }>(`/finance/transactions/${id}/reverse`),
    onSuccess: (r) => {
      toast.success('Voucher reversed', { description: `Contra entry ${r.voucherNo} posted.` });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (e) => toast.error('Could not reverse', { description: e instanceof ApiError ? e.message : '' }),
  });

  const rows = data?.data ?? [];
  const total = data?.meta.pagination.total ?? 0;
  const totalPages = data?.meta.pagination.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="Journal — every balanced double-entry posting." action={<NewJournalDialog />} />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b p-4">
          <Select value={vtype} onValueChange={(v) => { setVtype(v); setPage(1); }}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All voucher types</SelectItem>
              {VOUCHER_TYPES.map((v) => <SelectItem key={v.value} value={v.value}>{v.value} — {v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Voucher #</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-center">Lines</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="mx-auto h-4 w-6" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-24" /></TableCell>
                    <TableCell />
                  </TableRow>
                ))
              : rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.voucherNo ?? '—'}</TableCell>
                    <TableCell><Badge variant="secondary">{t.voucherType}</Badge></TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{String(t.occurredOn).slice(0, 10)}</TableCell>
                    <TableCell className="font-medium">{t.description}</TableCell>
                    <TableCell className="text-center tabular-nums">{t.lineCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(t.total.amountMinor, t.total.currency)}</TableCell>
                    <TableCell className="text-right">
                      {t.reversedById ? (
                        <Badge variant="warning">Reversed</Badge>
                      ) : t.reversesId ? (
                        <Badge variant="secondary">Contra</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={reverse.isPending} onClick={() => reverse.mutate(t.id)}>
                          <RotateCcw className="size-4" /> Reverse
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={NotebookPen} title="No journal entries" description="Post your first balanced entry." action={<NewJournalDialog />} />
          </div>
        ) : null}

        <div className={cn('flex items-center justify-between border-t p-4 text-sm text-muted-foreground', isFetching && 'opacity-60')}>
          <span>{total} entr{total === 1 ? 'y' : 'ies'}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="size-4" /></Button>
            <span className="tabular-nums">Page {page} / {totalPages}</span>
            <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-4" /></Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
