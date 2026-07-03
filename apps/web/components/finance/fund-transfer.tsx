'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Repeat } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, JournalTxn } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';

const today = () => new Date().toISOString().slice(0, 10);
const toMinor = (v: string) => Math.round((Number(v) || 0) * 100);
const PREFIX = 'Transfer:'; // recent-transfers list keys off this description prefix

/**
 * Fund transfer (contra) — move money between two cash/bank accounts. Posts a balanced voucher through
 * the existing `POST /finance/transactions`: Dr destination · Cr source. The voucher type follows the
 * destination account (BRV when bank, CRV when cash — money received into it), so it appears correctly
 * in the cash/bank books. Every entry's description is prefixed "Transfer:" so recent transfers can be
 * listed without a schema change.
 */
export function FundTransfer() {
  const qc = useQueryClient();
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts') });
  const { data: txns } = useQuery({ queryKey: ['transactions'], queryFn: () => apiGet<JournalTxn[]>('/finance/transactions?pageSize=100') });

  const moneyAccts = (accounts ?? []).filter((a) => !a.isGroup && (a.controlType === 'CASH' || a.controlType === 'BANK'));
  const recent = (txns ?? []).filter((t) => (t.description ?? '').startsWith(PREFIX)).slice(0, 12);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');

  const from = moneyAccts.find((a) => a.id === fromId);
  const to = moneyAccts.find((a) => a.id === toId);
  const voucherType = to?.controlType === 'BANK' ? 'BRV' : 'CRV';
  const sameAcct = !!fromId && fromId === toId;
  const valid = toMinor(amount) > 0 && !!fromId && !!toId && !sameAcct;

  const reset = () => { setAmount(''); setNote(''); setFromId(''); setToId(''); setDate(today()); };

  const post = useMutation({
    mutationFn: () => {
      const amt = toMinor(amount);
      const label = note.trim() || (from && to ? `${from.name} → ${to.name}` : 'fund transfer');
      return apiPost<{ status: string; voucherNo?: string }>('/finance/transactions', {
        description: `${PREFIX} ${label}`,
        voucherType,
        occurredOn: date,
        entries: [{ accountId: toId, debitMinor: amt }, { accountId: fromId, creditMinor: amt }],
      });
    },
    onSuccess: (r) => {
      toast.success('Transfer recorded', { description: r.voucherNo ? `Voucher ${r.voucherNo}` : '' });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      reset();
    },
    onError: (e) => toast.error('Could not record transfer', { description: e instanceof ApiError ? e.message : '' }),
  });

  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (valid) post.mutate(); };
  const fewAccounts = (accounts ?? []).length > 0 && moneyAccts.length < 2;

  return (
    <>
      <PaneHeader><span className="flex items-center gap-2 text-sm font-medium"><Repeat className="size-4 text-sky-600" /> Fund transfer</span></PaneHeader>
      <PaneBody className="space-y-6 p-5">
        {fewAccounts ? (
          <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            You need at least two Cash/Bank accounts in the Chart of Accounts to transfer between them
            (tag them with control type CASH or BANK).
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="max-w-xl space-y-4 rounded-xl border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Amount</Label>
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1.5"><Label className="text-xs">From (money out)</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger><SelectValue placeholder="Cash / bank" /></SelectTrigger>
                <SelectContent>{moneyAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name} <span className="text-muted-foreground">({a.controlType})</span></SelectItem>)}</SelectContent>
              </Select>
            </div>
            <ArrowRight className="mb-2 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1.5"><Label className="text-xs">To (money in)</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger><SelectValue placeholder="Cash / bank" /></SelectTrigger>
                <SelectContent>{moneyAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name} <span className="text-muted-foreground">({a.controlType})</span></SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {sameAcct ? <p className="text-xs text-destructive">Source and destination must be different accounts.</p> : null}

          <div className="space-y-1.5"><Label className="text-xs">Description</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cash deposited to bank" />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={!valid || post.isPending}><Check className="size-4" /> {post.isPending ? 'Saving…' : 'Record transfer'}</Button>
            {valid ? <span className="text-xs text-muted-foreground">Posts a <span className="font-mono">{voucherType}</span> voucher — Dr {to?.name} · Cr {from?.name}</span> : null}
          </div>
        </form>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent transfers</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Voucher</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody className="divide-y">
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.voucherNo ?? 'Draft'} · {t.voucherType}</td>
                    <td className="px-3 py-2">{(t.description ?? '').replace(PREFIX, '').trim()}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-sky-600">{formatMoney(t.total.amountMinor, t.total.currency)}</td>
                  </tr>
                ))}
                {recent.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No transfers yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}
