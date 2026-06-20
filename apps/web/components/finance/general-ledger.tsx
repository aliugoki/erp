'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Account, Ledger } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader, EmptyDetail } from '@/components/ui/three-pane';
import { AccountTypeBadge, fmtDate } from '@/components/finance/fin-ui';

/** Per-account general ledger: opening balance, posted movements, running balance, closing balance. */
export function GeneralLedger() {
  const [accountId, setAccountId] = useState('');
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts') });
  const ledger = useQuery({
    queryKey: ['ledger', accountId],
    queryFn: () => apiGet<Ledger>(`/finance/ledger/${accountId}`),
    enabled: !!accountId,
  });

  const selected = (accounts.data ?? []).find((a) => a.id === accountId);
  const d = ledger.data;

  return (
    <>
      <PaneHeader>
        <select
          className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Select an account…</option>
          {(accounts.data ?? []).filter((a) => !a.isGroup).map((a) => (
            <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
          ))}
        </select>
        {selected ? <AccountTypeBadge type={selected.type} /> : null}
      </PaneHeader>
      <PaneBody className="space-y-4 p-5">
        {!accountId ? (
          <EmptyDetail icon={BookOpen} title="No account selected" hint="Select an account to view its ledger." />
        ) : ledger.isLoading ? (
          <div className="flex flex-1 items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : d ? (
          <>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Opening balance</span>
              <span className="tabular-nums">{formatMoney(d.opening.amountMinor, d.opening.currency)}</span>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Voucher</th><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th><th className="px-4 py-2 text-right">Balance</th></tr></thead>
                <tbody className="divide-y">
                  {d.lines.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No transactions in this period.</td></tr>
                  ) : (
                    d.lines.map((l) => (
                      <tr key={l.transactionId}>
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{fmtDate(l.occurredOn)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{l.voucherNo ?? '—'}</td>
                        <td className="px-4 py-2">{l.description}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{l.debit.amountMinor ? formatMoney(l.debit.amountMinor, l.debit.currency) : '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{l.credit.amountMinor ? formatMoney(l.credit.amountMinor, l.credit.currency) : '—'}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(l.balance.amountMinor, l.balance.currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 text-sm">
              <span className="font-semibold">Closing balance</span>
              <span className="font-semibold tabular-nums">{formatMoney(d.closing.amountMinor, d.closing.currency)}</span>
            </div>
          </>
        ) : null}
      </PaneBody>
    </>
  );
}
