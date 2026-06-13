'use client';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import { apiList } from '@/lib/api';
import type { JournalTxn } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { NewJournalDialog } from '@/components/finance/new-journal-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function JournalPage() {
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['transactions', page],
    queryFn: () => apiList<JournalTxn>(`/finance/transactions?page=${page}&pageSize=${pageSize}`),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const total = data?.meta.pagination.total ?? 0;
  const totalPages = data?.meta.pagination.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="Journal — every balanced double-entry posting." action={<NewJournalDialog />} />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-center">Lines</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="mx-auto h-4 w-6" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-24" /></TableCell>
                  </TableRow>
                ))
              : rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{String(t.occurredOn).slice(0, 10)}</TableCell>
                    <TableCell className="font-medium">{t.description}</TableCell>
                    <TableCell className="text-muted-foreground">{t.reference ?? '—'}</TableCell>
                    <TableCell className="text-center tabular-nums">{t.lineCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(t.total.amountMinor, t.total.currency)}</TableCell>
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
