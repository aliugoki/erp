'use client';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Receipt } from 'lucide-react';
import { apiList } from '@/lib/api';
import type { Bill, BillStatus } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { NewBillDialog } from '@/components/finance/new-bill-dialog';
import { NewVendorDialog } from '@/components/finance/new-vendor-dialog';
import { PayBillDialog } from '@/components/finance/pay-bill-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS: Record<BillStatus, { variant: 'success' | 'secondary' | 'warning' | 'destructive' }> = {
  PAID: { variant: 'success' },
  PARTIALLY_PAID: { variant: 'warning' },
  RECEIVED: { variant: 'secondary' },
  DRAFT: { variant: 'secondary' },
  VOID: { variant: 'destructive' },
};

export default function PayablesPage() {
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status !== 'ALL') params.set('status', status);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['bills', status, page],
    queryFn: () => apiList<Bill>(`/finance/bills?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const total = data?.meta.pagination.total ?? 0;
  const totalPages = data?.meta.pagination.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader
        title="Finance"
        description="Accounts Payable — vendor bills and payments."
        action={<div className="flex gap-2"><NewVendorDialog /><NewBillDialog /></div>}
      />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b p-4">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All bills</SelectItem>
              <SelectItem value="RECEIVED">Received</SelectItem>
              <SelectItem value="PARTIALLY_PAID">Partially paid</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="VOID">Void</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill #</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
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
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell />
                  </TableRow>
                ))
              : rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.number}</TableCell>
                    <TableCell>{b.vendorName ?? '—'}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{b.dueDate ? String(b.dueDate).slice(0, 10) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(b.total.amountMinor, b.total.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(b.outstanding.amountMinor, b.outstanding.currency)}</TableCell>
                    <TableCell><Badge variant={STATUS[b.status].variant}>{b.status.replace('_', ' ')}</Badge></TableCell>
                    <TableCell className="text-right">
                      {b.status === 'PAID' || b.status === 'VOID'
                        ? <span className="text-xs text-muted-foreground">—</span>
                        : <PayBillDialog bill={b} />}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Receipt} title="No bills" description="Add a vendor, then record your first bill." action={<NewBillDialog />} />
          </div>
        ) : null}

        <div className={cn('flex items-center justify-between border-t p-4 text-sm text-muted-foreground', isFetching && 'opacity-60')}>
          <span>{total} bill{total === 1 ? '' : 's'}</span>
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
