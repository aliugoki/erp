'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, Reconciliation as Recon } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader, EmptyDetail } from '@/components/ui/three-pane';
import { fmtDate } from '@/components/finance/fin-ui';
import { ImportStatementDialog } from './import-statement-dialog';

/** Bank/cash reconciliation: book vs cleared balances, statement import, auto-match, manual clearing. */
export function Reconciliation() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [checked, setChecked] = useState<string[]>([]);

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts') });
  const recon = useQuery({
    queryKey: ['reconciliation', accountId],
    queryFn: () => apiGet<Recon>(`/finance/reconciliation/${accountId}`),
    enabled: !!accountId,
  });

  const autoMatch = useMutation({
    mutationFn: () => apiPost('/finance/bank-statements/auto-match', { accountId }),
    onSuccess: () => {
      toast.success('Auto-match complete');
      qc.invalidateQueries({ queryKey: ['reconciliation', accountId] });
    },
    onError: (e) => toast.error('Auto-match failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  const markReconciled = useMutation({
    mutationFn: () => apiPost('/finance/reconciliation', { entryIds: checked, reconciled: true }),
    onSuccess: () => {
      toast.success('Entries marked reconciled');
      setChecked([]);
      qc.invalidateQueries({ queryKey: ['reconciliation', accountId] });
    },
    onError: (e) => toast.error('Failed to reconcile', { description: e instanceof ApiError ? e.message : '' }),
  });

  const cashBankAccounts = (accounts.data ?? []).filter((a) => a.controlType === 'CASH' || a.controlType === 'BANK');
  const d = recon.data;

  const toggle = (id: string) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <>
      <PaneHeader>
        <select
          className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
          value={accountId}
          onChange={(e) => { setAccountId(e.target.value); setChecked([]); }}
        >
          <option value="">Select cash/bank account…</option>
          {cashBankAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
          ))}
        </select>
        {accountId ? (
          <>
            <ImportStatementDialog accountId={accountId} />
            <Button size="sm" variant="outline" onClick={() => autoMatch.mutate()} disabled={autoMatch.isPending}>
              {autoMatch.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Auto-match
            </Button>
          </>
        ) : null}
      </PaneHeader>
      <PaneBody className="space-y-4 p-5">
        {!accountId ? (
          <EmptyDetail icon={Wallet} title="No account selected" hint="Select a cash or bank account to reconcile." />
        ) : recon.isLoading ? (
          <div className="flex flex-1 items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : d ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Book balance</p>
                <p className="mt-1 font-semibold tabular-nums">{formatMoney(d.bookBalance.amountMinor, d.bookBalance.currency)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Cleared balance</p>
                <p className="mt-1 font-semibold tabular-nums">{formatMoney(d.clearedBalance.amountMinor, d.clearedBalance.currency)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Uncleared ({d.unclearedCount})</p>
                <p className="mt-1 font-semibold tabular-nums">{formatMoney(d.unclearedBalance.amountMinor, d.unclearedBalance.currency)}</p>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Button size="sm" onClick={() => markReconciled.mutate()} disabled={checked.length === 0 || markReconciled.isPending}>
                {markReconciled.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Mark reconciled{checked.length > 0 ? ` (${checked.length})` : ''}
              </Button>
            </div>

            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="w-10 px-4 py-2" /><th className="px-4 py-2">Date</th><th className="px-4 py-2">Voucher</th><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th><th className="px-4 py-2 text-center">Cleared</th></tr></thead>
                <tbody className="divide-y">
                  {d.entries.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No entries to reconcile.</td></tr>
                  ) : (
                    d.entries.map((e) => (
                      <tr key={e.entryId} className={e.reconciled ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''}>
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            className="size-4 rounded border"
                            checked={checked.includes(e.entryId)}
                            disabled={e.reconciled}
                            onChange={() => toggle(e.entryId)}
                          />
                        </td>
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{fmtDate(e.occurredOn)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{e.voucherNo ?? '—'}</td>
                        <td className="px-4 py-2">{e.description}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{e.debit.amountMinor ? formatMoney(e.debit.amountMinor, e.debit.currency) : '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{e.credit.amountMinor ? formatMoney(e.credit.amountMinor, e.credit.currency) : '—'}</td>
                        <td className="px-4 py-2 text-center text-emerald-600 dark:text-emerald-400">{e.reconciled ? '✓' : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </PaneBody>
    </>
  );
}
