'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, Reconciliation } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts') });
  const cashBank = (accounts ?? []).filter((a) => a.controlType !== 'NONE');

  const { data: recon } = useQuery({
    queryKey: ['reconciliation', accountId],
    queryFn: () => apiGet<Reconciliation>(`/finance/reconciliation/${accountId}`),
    enabled: Boolean(accountId),
  });

  const mark = useMutation({
    mutationFn: (reconciled: boolean) => apiPost('/finance/reconciliation', { entryIds: [...sel], reconciled }),
    onSuccess: (_r, reconciled) => {
      toast.success(reconciled ? 'Marked cleared' : 'Marked uncleared');
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['reconciliation'] });
    },
    onError: (e) => toast.error('Could not update', { description: e instanceof ApiError ? e.message : '' }),
  });

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="Bank reconciliation — tick the postings that appear on your statement." />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Select value={accountId} onValueChange={(v) => { setAccountId(v); setSel(new Set()); }}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Select a cash/bank account…" /></SelectTrigger>
            <SelectContent>
              {cashBank.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name} ({a.controlType})</SelectItem>)}
            </SelectContent>
          </Select>
          {recon ? (
            <div className="ml-auto flex items-center gap-5 text-sm">
              <span className="text-muted-foreground">Book <span className="tabular-nums text-foreground">{formatMoney(recon.bookBalance.amountMinor)}</span></span>
              <span className="text-muted-foreground">Cleared <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(recon.clearedBalance.amountMinor)}</span></span>
              <span className="text-muted-foreground">Uncleared <span className="tabular-nums text-destructive">{formatMoney(recon.unclearedBalance.amountMinor)}</span></span>
            </div>
          ) : null}
        </div>

        {!accountId ? (
          <div className="p-4">
            <EmptyState icon={ListChecks} title="Pick a cash/bank account" description="Tag accounts as Cash or Bank in the Chart of Accounts to reconcile them." />
          </div>
        ) : (
          <>
            {sel.size > 0 ? (
              <div className="flex items-center gap-3 border-b bg-muted/40 p-3 text-sm">
                <span>{sel.size} selected</span>
                <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => mark.mutate(true)}>Mark cleared</Button>
                <Button size="sm" variant="ghost" disabled={mark.isPending} onClick={() => mark.mutate(false)}>Mark uncleared</Button>
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-center">Cleared</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recon?.entries.length ?? 0) === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No postings.</TableCell></TableRow>
                ) : (
                  recon!.entries.map((e) => (
                    <TableRow key={e.entryId} data-state={sel.has(e.entryId) ? 'selected' : undefined}>
                      <TableCell>
                        <input type="checkbox" className="size-4 accent-primary" checked={sel.has(e.entryId)} onChange={() => toggle(e.entryId)} />
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{String(e.occurredOn).slice(0, 10)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{e.voucherNo ?? '—'}</TableCell>
                      <TableCell>{e.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.debit.amountMinor ? formatMoney(e.debit.amountMinor) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.credit.amountMinor ? formatMoney(e.credit.amountMinor) : '—'}</TableCell>
                      <TableCell className="text-center">{e.reconciled ? '✓' : ''}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
