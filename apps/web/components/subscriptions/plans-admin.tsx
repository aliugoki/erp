'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import type { SubPlan } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { intervalLabel } from './ui';

const INTERVALS = ['DAY', 'WEEK', 'MONTH', 'YEAR'];
const blank = { name: '', code: '', amount: '', billingInterval: 'MONTH', intervalCount: '1', trialDays: '0', setupFee: '0', taxRate: '0' };

export function PlansAdmin() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const plans = useQuery({ queryKey: ['sub-plans'], queryFn: () => apiGet<SubPlan[]>('/subscriptions/plans') });

  const create = useMutation({
    mutationFn: () => apiPost<SubPlan>('/subscriptions/plans', {
      name: f.name, code: f.code || undefined,
      amountMinor: Math.round((Number(f.amount) || 0) * 100), taxRate: Number(f.taxRate) || 0,
      billingInterval: f.billingInterval, intervalCount: Number(f.intervalCount) || 1,
      trialDays: Number(f.trialDays) || 0, setupFeeMinor: Math.round((Number(f.setupFee) || 0) * 100),
    }),
    onSuccess: () => { toast.success('Plan created'); setF(blank); setOpen(false); void qc.invalidateQueries({ queryKey: ['sub-plans'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => apiDelete(`/subscriptions/plans/${id}`),
    onSuccess: () => { toast.success('Plan archived'); void qc.invalidateQueries({ queryKey: ['sub-plans'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const list = plans.data ?? [];
  const valid = f.name.trim() && Number(f.amount) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Plans define a price per billing cycle. Subscribers are billed automatically each interval.</p>
        <Button size="sm" onClick={() => setOpen((v) => !v)}><Plus className="mr-2 h-4 w-4" /> New plan</Button>
      </div>

      {open ? (
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Name"><Input value={f.name} onChange={set('name')} placeholder="Pro Monthly" /></Field>
            <Field label="Code"><Input value={f.code} onChange={set('code')} placeholder="PRO-M (optional)" /></Field>
            <Field label="Price"><Input value={f.amount} onChange={set('amount')} type="number" min={0} step="0.01" placeholder="0.00" /></Field>
            <Field label="Tax %"><Input value={f.taxRate} onChange={set('taxRate')} type="number" min={0} max={100} /></Field>
            <Field label="Interval">
              <select value={f.billingInterval} onChange={set('billingInterval')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                {INTERVALS.map((i) => <option key={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Every (count)"><Input value={f.intervalCount} onChange={set('intervalCount')} type="number" min={1} /></Field>
            <Field label="Trial days"><Input value={f.trialDays} onChange={set('trialDays')} type="number" min={0} /></Field>
            <Field label="Setup fee"><Input value={f.setupFee} onChange={set('setupFee')} type="number" min={0} step="0.01" /></Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setOpen(false); setF(blank); }}>Cancel</Button>
            <Button size="sm" disabled={!valid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create plan</Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">Billing</th><th className="px-4 py-2">Trial</th><th className="px-4 py-2">Active subs</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody className="divide-y">
            {plans.isLoading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No plans yet — create one to start billing.</td></tr>
            ) : list.map((p) => (
              <tr key={p.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5"><div className="font-medium">{p.name}</div>{p.code ? <div className="text-xs text-muted-foreground">{p.code}</div> : null}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(p.price.amountMinor, p.price.currency)}{p.taxRate > 0 ? <span className="text-xs text-muted-foreground"> +{p.taxRate}%</span> : null}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{intervalLabel(p.billingInterval, p.intervalCount)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.trialDays > 0 ? `${p.trialDays} days` : '—'}</td>
                <td className="px-4 py-2.5 tabular-nums">{p.activeSubscriptions ?? 0}</td>
                <td className="px-4 py-2.5">{p.status === 'ACTIVE' ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">ACTIVE</span> : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">ARCHIVED</span>}</td>
                <td className="px-4 py-2.5 text-right">{p.status === 'ACTIVE' ? <Button variant="ghost" size="sm" onClick={() => archive.mutate(p.id)} title="Archive"><Archive className="h-4 w-4" /></Button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}
