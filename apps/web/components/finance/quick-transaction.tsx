'use client';
import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, Check } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, CostCenter, JournalTxn } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';

const NONE = '__none__';
const today = () => new Date().toISOString().slice(0, 10);
const toMinor = (v: string) => Math.round((Number(v) || 0) * 100);

/**
 * Simplified income / expense entry — a single-amount form that posts the correct balanced voucher
 * through the existing `POST /finance/transactions`, so users don't have to build a double-entry by
 * hand:
 *   Income  → Dr Cash/Bank · Cr Income   (BRV / CRV)
 *   Expense → Dr Expense    · Cr Cash/Bank (BPV / CPV)
 * The voucher type is derived from the chosen cash/bank account's control type.
 */
export function QuickTransaction({ kind }: { kind: 'income' | 'expense' }) {
  const qc = useQueryClient();
  const income = kind === 'income';
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts') });
  const { data: costCenters } = useQuery({ queryKey: ['cost-centers'], queryFn: () => apiGet<CostCenter[]>('/finance/cost-centers') });
  const { data: txns } = useQuery({ queryKey: ['transactions'], queryFn: () => apiGet<JournalTxn[]>('/finance/transactions?pageSize=100') });

  const leaves = (accounts ?? []).filter((a) => !a.isGroup);
  const moneyAccts = leaves.filter((a) => a.controlType === 'CASH' || a.controlType === 'BANK');
  const targetAccts = leaves.filter((a) => a.type === (income ? 'REVENUE' : 'EXPENSE'));
  const vtSet = income ? ['BRV', 'CRV'] : ['BPV', 'CPV'];
  const recent = (txns ?? []).filter((t) => vtSet.includes(t.voucherType)).slice(0, 12);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [targetId, setTargetId] = useState('');
  const [moneyId, setMoneyId] = useState('');
  const [costCenterId, setCostCenterId] = useState(NONE);

  const money = leaves.find((a) => a.id === moneyId);
  const voucherType = useMemo(() => {
    const bank = money?.controlType === 'BANK';
    return income ? (bank ? 'BRV' : 'CRV') : (bank ? 'BPV' : 'CPV');
  }, [money, income]);

  const reset = () => { setAmount(''); setDescription(''); setTargetId(''); setMoneyId(''); setCostCenterId(NONE); setDate(today()); };

  const post = useMutation({
    mutationFn: () => {
      const amt = toMinor(amount);
      const cc = costCenterId !== NONE ? { costCenterId } : {};
      // income: Dr money / Cr income; expense: Dr expense / Cr money. Cost center tags the P&L line.
      const entries = income
        ? [{ accountId: moneyId, debitMinor: amt }, { accountId: targetId, creditMinor: amt, ...cc }]
        : [{ accountId: targetId, debitMinor: amt, ...cc }, { accountId: moneyId, creditMinor: amt }];
      return apiPost<{ status: string; voucherNo?: string }>('/finance/transactions', {
        description: description || (income ? 'Income received' : 'Expense paid'),
        voucherType,
        occurredOn: date,
        entries,
      });
    },
    onSuccess: (r) => {
      toast.success(income ? 'Income recorded' : 'Expense recorded', { description: r.voucherNo ? `Voucher ${r.voucherNo}` : '' });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      reset();
    },
    onError: (e) => toast.error('Could not record', { description: e instanceof ApiError ? e.message : '' }),
  });

  const noAccounts = leaves.length > 0 && (moneyAccts.length === 0 || targetAccts.length === 0);
  const valid = toMinor(amount) > 0 && !!targetId && !!moneyId;
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (valid) post.mutate(); };

  const Icon = income ? ArrowDownCircle : ArrowUpCircle;
  const accent = income ? 'text-emerald-600' : 'text-rose-600';

  return (
    <>
      <PaneHeader><span className="flex items-center gap-2 text-sm font-medium"><Icon className={`size-4 ${accent}`} /> {income ? 'Record income' : 'Record expense'}</span></PaneHeader>
      <PaneBody className="space-y-6 p-5">
        {noAccounts ? (
          <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            You need {income ? 'a revenue (income)' : 'an expense'} account and at least one Cash/Bank account in the
            Chart of Accounts before you can record {income ? 'income' : 'expenses'}. Add them in Chart of Accounts
            (tag the cash/bank account with control type CASH or BANK).
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

          <div className="space-y-1.5"><Label className="text-xs">{income ? 'Income account (credit)' : 'Expense account (debit)'}</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger><SelectValue placeholder={income ? 'Select income account' : 'Select expense account'} /></SelectTrigger>
              <SelectContent>{targetAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5"><Label className="text-xs">{income ? 'Received in (cash / bank)' : 'Paid from (cash / bank)'}</Label>
            <Select value={moneyId} onValueChange={setMoneyId}>
              <SelectTrigger><SelectValue placeholder="Select cash / bank account" /></SelectTrigger>
              <SelectContent>{moneyAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name} <span className="text-muted-foreground">({a.controlType})</span></SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={income ? 'e.g. Consulting income' : 'e.g. Office rent'} />
            </div>
            {(costCenters ?? []).length > 0 ? (
              <div className="space-y-1.5"><Label className="text-xs">Cost center</Label>
                <Select value={costCenterId} onValueChange={setCostCenterId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>—</SelectItem>{(costCenters ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={!valid || post.isPending}><Check className="size-4" /> {post.isPending ? 'Saving…' : income ? 'Record income' : 'Record expense'}</Button>
            {valid ? <span className="text-xs text-muted-foreground">Posts a <span className="font-mono">{voucherType}</span> voucher — {income ? 'Dr cash/bank · Cr income' : 'Dr expense · Cr cash/bank'}</span> : null}
          </div>
        </form>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent {income ? 'income' : 'expenses'}</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Voucher</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody className="divide-y">
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.voucherNo ?? 'Draft'} · {t.voucherType}</td>
                    <td className="px-3 py-2">{t.description}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${accent}`}>{formatMoney(t.total.amountMinor, t.total.currency)}</td>
                  </tr>
                ))}
                {recent.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No {income ? 'income' : 'expense'} entries yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}
