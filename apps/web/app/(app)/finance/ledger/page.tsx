'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Account, Ledger } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function LedgerPage() {
  const [accountId, setAccountId] = useState<string>('');

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts') });
  const postable = (accounts ?? []).filter((a) => !a.isGroup);

  const { data: ledger, isLoading } = useQuery({
    queryKey: ['ledger', accountId],
    queryFn: () => apiGet<Ledger>(`/finance/ledger/${accountId}`),
    enabled: Boolean(accountId),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="General ledger — every posting to an account with a running balance." />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Select an account…" /></SelectTrigger>
            <SelectContent>
              {postable.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {ledger ? (
            <div className="ml-auto flex items-center gap-6 text-sm">
              <span className="text-muted-foreground">Opening <span className="tabular-nums text-foreground">{formatMoney(ledger.opening.amountMinor, ledger.opening.currency)}</span></span>
              <span className="font-medium">Closing <span className="tabular-nums">{formatMoney(ledger.closing.amountMinor, ledger.closing.currency)}</span></span>
            </div>
          ) : null}
        </div>

        {!accountId ? (
          <div className="p-4">
            <EmptyState icon={BookOpen} title="Pick an account" description="Choose a postable account to view its ledger." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Voucher</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : (ledger?.lines.length ?? 0) === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No postings for this account.</TableCell></TableRow>
              ) : (
                ledger!.lines.map((l, i) => (
                  <TableRow key={`${l.transactionId}-${i}`}>
                    <TableCell className="tabular-nums text-muted-foreground">{String(l.occurredOn).slice(0, 10)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{l.voucherNo ?? '—'}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.debit.amountMinor ? formatMoney(l.debit.amountMinor, l.debit.currency) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.credit.amountMinor ? formatMoney(l.credit.amountMinor, l.credit.currency) : '—'}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(l.balance.amountMinor, l.balance.currency)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
