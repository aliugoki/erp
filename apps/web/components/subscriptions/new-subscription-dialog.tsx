'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import type { SubPlan, Subscription } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { intervalSuffix } from './ui';

export function NewSubscriptionDialog({ plans, onClose }: { plans: SubPlan[]; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const active = plans.filter((p) => p.status === 'ACTIVE');
  const [f, setF] = useState({ planId: active[0]?.id ?? '', customerName: '', customerEmail: '', quantity: '1', collectionMode: 'AUTO' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const plan = active.find((p) => p.id === f.planId);

  const create = useMutation({
    mutationFn: () => apiPost<Subscription>('/subscriptions', {
      planId: f.planId, customerName: f.customerName, customerEmail: f.customerEmail,
      quantity: Number(f.quantity) || 1, collectionMode: f.collectionMode,
    }),
    onSuccess: (s) => {
      toast.success(`Subscription ${s.subscriptionNo} created`);
      void qc.invalidateQueries({ queryKey: ['subs'] });
      void qc.invalidateQueries({ queryKey: ['sub-metrics'] });
      router.push(`/subscriptions/${s.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const valid = f.planId && f.customerName.trim() && /.+@.+\..+/.test(f.customerEmail);
  const qty = Number(f.quantity) || 1;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>New subscription</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Plan">
            <select value={f.planId} onChange={set('planId')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              {active.length === 0 ? <option value="">No active plans — create one first</option> : null}
              {active.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price.amountMinor, p.price.currency)}{intervalSuffix(p.billingInterval, p.intervalCount)}{p.trialDays > 0 ? ` · ${p.trialDays}d trial` : ''}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer name"><Input value={f.customerName} onChange={set('customerName')} /></Field>
            <Field label="Customer email"><Input value={f.customerEmail} onChange={set('customerEmail')} type="email" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity"><Input value={f.quantity} onChange={set('quantity')} type="number" min={1} /></Field>
            <Field label="Collection">
              <select value={f.collectionMode} onChange={set('collectionMode')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                <option value="AUTO">Auto-charge</option>
                <option value="MANUAL">Manual / invoice</option>
              </select>
            </Field>
          </div>
          {plan ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Recurring total</span>
                <span className="font-semibold tabular-nums">{formatMoney(plan.price.amountMinor * qty, plan.price.currency)}{intervalSuffix(plan.billingInterval, plan.intervalCount)}</span>
              </div>
              {plan.trialDays > 0 ? <p className="mt-1 text-xs text-muted-foreground">Starts with a {plan.trialDays}-day free trial — first invoice after the trial ends.</p>
                : <p className="mt-1 text-xs text-muted-foreground">{f.collectionMode === 'AUTO' ? 'First invoice is charged immediately.' : 'First invoice is issued now (manual payment).'}{plan.setupFee.amountMinor > 0 ? ` Includes a ${formatMoney(plan.setupFee.amountMinor, plan.setupFee.currency)} setup fee.` : ''}</p>}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}
