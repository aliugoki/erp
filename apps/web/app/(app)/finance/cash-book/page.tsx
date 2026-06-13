'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { CashBook } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function CashBookPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data } = useQuery({
    queryKey: ['cash-book', from, to],
    queryFn: () => apiGet<CashBook>(`/finance/cash-book${params.toString() ? `?${params}` : ''}`),
  });
  const accounts = data?.accounts ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="Cash & Bank book — receipts, payments and running position per cash/bank account." />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="space-y-1">
            <Label htmlFor="from" className="text-xs">From</Label>
            <Input id="from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to" className="text-xs">To</Label>
            <Input id="to" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {data ? (
            <div className="ml-auto text-sm text-muted-foreground">
              Receipts <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(data.totals.receiptsMinor)}</span>
              {' · '}Payments <span className="tabular-nums text-destructive">{formatMoney(data.totals.paymentsMinor)}</span>
              {' · '}Closing <span className="tabular-nums font-medium text-foreground">{formatMoney(data.totals.closingMinor)}</span>
            </div>
          ) : null}
        </div>

        {accounts.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Landmark} title="No cash or bank accounts" description="Tag a detail account as Cash or Bank in the Chart of Accounts." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead></TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Receipts</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Closing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.accountId}>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}
                    {a.bankName ? <span className="ml-2 text-xs text-muted-foreground">{a.bankName} {a.accountNumber ?? ''}</span> : null}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{a.controlType}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(a.opening.amountMinor, a.opening.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(a.receipts.amountMinor, a.receipts.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{formatMoney(a.payments.amountMinor, a.payments.currency)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(a.closing.amountMinor, a.closing.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
