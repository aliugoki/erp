'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { JournalTxn, TxnDetail } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** View a transaction's double-entry detail (the journal lines), fetched on open. */
export function TransactionDetailDialog({ txn }: { txn: JournalTxn }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['transaction', txn.id],
    queryFn: () => apiGet<TxnDetail>(`/finance/transactions/${txn.id}`),
    enabled: open,
  });

  const totalDr = (data?.entries ?? []).reduce((s, e) => s + e.debit.amountMinor, 0);
  const totalCr = (data?.entries ?? []).reduce((s, e) => s + e.credit.amountMinor, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><Eye className="size-4" /> Details</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {txn.voucherNo ?? 'Voucher'} <Badge variant="secondary">{txn.voucherType}</Badge>
            <Badge variant={txn.status === 'DRAFT' ? 'warning' : 'success'}>{txn.status}</Badge>
          </DialogTitle>
          <DialogDescription>
            {data?.description ?? txn.description} · {String(txn.occurredOn).slice(0, 10)}
            {data?.reference ? ` · ref ${data.reference}` : ''}
          </DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Cost ctr</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : (
              (data?.entries ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{e.accountCode}</span> {e.accountName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.costCenterCode ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.debit.amountMinor ? formatMoney(e.debit.amountMinor, e.debit.currency) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.credit.amountMinor ? formatMoney(e.credit.amountMinor, e.credit.currency) : '—'}</TableCell>
                </TableRow>
              ))
            )}
            <TableRow className="border-t-2">
              <TableCell colSpan={2} className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totalDr)}</TableCell>
              <TableCell className={cn('text-right font-semibold tabular-nums', totalDr !== totalCr && 'text-destructive')}>{formatMoney(totalCr)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
