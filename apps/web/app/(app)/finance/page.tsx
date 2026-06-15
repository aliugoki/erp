'use client';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { apiList } from '@/lib/api';
import type { Invoice } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { NewInvoiceDialog } from '@/components/finance/new-invoice-dialog';
import { ReceiveInvoiceDialog } from '@/components/finance/receive-invoice-dialog';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS: Record<Invoice['status'], { variant: 'success' | 'secondary' | 'warning' | 'destructive' }> = {
  PAID: { variant: 'success' },
  SENT: { variant: 'warning' },
  DRAFT: { variant: 'secondary' },
  VOID: { variant: 'destructive' },
};

export default function FinancePage() {
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status !== 'ALL') params.set('status', status);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['invoices', status, page],
    queryFn: () => apiList<Invoice>(`/finance/invoices?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const total = data?.meta.pagination.total ?? 0;
  const totalPages = data?.meta.pagination.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="Invoices and payments." action={<NewInvoiceDialog />} />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b p-4">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All invoices</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="VOID">Void</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                    <TableCell />
                  </TableRow>
                ))
              : rows.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.number}</TableCell>
                    <TableCell>{inv.customerName ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">{formatMoney(inv.total.amountMinor, inv.total.currency)}</TableCell>
                    <TableCell><Badge variant={STATUS[inv.status].variant}>{inv.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {inv.status === 'PAID' || inv.status === 'VOID' ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <ReceiveInvoiceDialog invoice={inv} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={FileText} title="No invoices" description="Create your first invoice." action={<NewInvoiceDialog />} />
          </div>
        ) : null}

        <div className={cn('flex items-center justify-between border-t p-4 text-sm text-muted-foreground', isFetching && 'opacity-60')}>
          <span>{total} invoice{total === 1 ? '' : 's'}</span>
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
