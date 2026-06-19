'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Archive, Layers, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiPatch, apiPost } from '@/lib/api';
import type { SubPlan } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';

const INTERVALS = ['DAY', 'WEEK', 'MONTH', 'YEAR'];
const empty = { name: '', code: '', amount: '', billingInterval: 'MONTH', intervalCount: '1', trialDays: '0', setupFee: '0', taxRate: '0', status: 'ACTIVE' };

/** Create or edit a plan (full CRUD: create / read / update / archive), sized for the detail pane. */
export function PlanDetail({ mode, plan, onBack, onSaved, onDeleted }: { mode: 'new' | 'edit'; plan?: SubPlan | null; onBack?: () => void; onSaved?: (p: SubPlan) => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (mode === 'edit' && plan) {
      setF({
        name: plan.name, code: plan.code ?? '', amount: String(plan.price.amountMinor / 100),
        billingInterval: plan.billingInterval, intervalCount: String(plan.intervalCount), trialDays: String(plan.trialDays),
        setupFee: String(plan.setupFee.amountMinor / 100), taxRate: String(plan.taxRate), status: plan.status,
      });
    } else if (mode === 'new') {
      setF(empty);
    }
  }, [mode, plan]);

  const body = () => ({
    name: f.name, code: f.code || undefined,
    amountMinor: Math.round((Number(f.amount) || 0) * 100), taxRate: Number(f.taxRate) || 0,
    billingInterval: f.billingInterval, intervalCount: Number(f.intervalCount) || 1,
    trialDays: Number(f.trialDays) || 0, setupFeeMinor: Math.round((Number(f.setupFee) || 0) * 100),
    status: f.status,
  });

  const save = useMutation({
    mutationFn: () => (mode === 'edit' && plan ? apiPatch<SubPlan>(`/subscriptions/plans/${plan.id}`, body()) : apiPost<SubPlan>('/subscriptions/plans', body())),
    onSuccess: (p) => { toast.success(mode === 'edit' ? 'Plan updated' : 'Plan created'); void qc.invalidateQueries({ queryKey: ['sub-plans'] }); onSaved?.(p); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const archive = useMutation({
    mutationFn: () => apiDelete(`/subscriptions/plans/${plan!.id}`),
    onSuccess: () => { toast.success('Plan archived'); void qc.invalidateQueries({ queryKey: ['sub-plans'] }); onDeleted?.(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const valid = f.name.trim() && Number(f.amount) > 0;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><Layers className="h-4 w-4 text-violet-600" /><span className="truncate font-semibold">{mode === 'new' ? 'New plan' : plan?.name}</span></div>
        {mode === 'edit' && plan?.status === 'ACTIVE' ? <Button variant="outline" size="sm" onClick={() => archive.mutate()} disabled={archive.isPending}><Archive className="mr-1.5 h-4 w-4" /> Archive</Button> : null}
      </PaneHeader>
      <PaneBody className="p-5">
        <div className="grid max-w-xl grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={set('name')} placeholder="Pro Monthly" /></Field>
          <Field label="Code"><Input value={f.code} onChange={set('code')} placeholder="PRO-M (optional)" /></Field>
          <Field label="Status">
            <select value={f.status} onChange={set('status')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              {['ACTIVE', 'ARCHIVED'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Price (per cycle)"><Input value={f.amount} onChange={set('amount')} type="number" min={0} step="0.01" placeholder="0.00" /></Field>
          <Field label="Tax %"><Input value={f.taxRate} onChange={set('taxRate')} type="number" min={0} max={100} /></Field>
          <Field label="Interval">
            <select value={f.billingInterval} onChange={set('billingInterval')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              {INTERVALS.map((i) => <option key={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Every (count)"><Input value={f.intervalCount} onChange={set('intervalCount')} type="number" min={1} /></Field>
          <Field label="Trial days"><Input value={f.trialDays} onChange={set('trialDays')} type="number" min={0} /></Field>
          <Field label="Setup fee"><Input value={f.setupFee} onChange={set('setupFee')} type="number" min={0} step="0.01" /></Field>
          {mode === 'edit' && plan ? <div className="col-span-2 text-xs text-muted-foreground">{plan.activeSubscriptions ?? 0} active subscription(s) on this plan. Price/interval changes apply to each subscriber on their next cycle.</div> : null}
          <div className="col-span-2 flex justify-end">
            <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} {mode === 'new' ? 'Create plan' : 'Save changes'}</Button>
          </div>
        </div>
      </PaneBody>
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
