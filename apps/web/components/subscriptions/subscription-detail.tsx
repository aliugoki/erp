'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2, PauseCircle, PlayCircle, Repeat, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { SubInvoice, SubPlan, Subscription } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { InvoiceStatusBadge, SubStatusBadge, fmtDate, intervalLabel, timeUntil } from './ui';

/** Full subscription detail + lifecycle actions, sized to live inside the three-pane detail column. */
export function SubscriptionDetail({ id, onBack, onChanged }: { id: string; onBack?: () => void; onChanged?: () => void }) {
  const qc = useQueryClient();
  const [changing, setChanging] = useState(false);
  const [qty, setQty] = useState('');
  const [planId, setPlanId] = useState('');

  const sub = useQuery({ queryKey: ['sub', id], queryFn: () => apiGet<Subscription>(`/subscriptions/${id}`) });
  const plans = useQuery({ queryKey: ['sub-plans'], queryFn: () => apiGet<SubPlan[]>('/subscriptions/plans') });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['sub', id] });
    void qc.invalidateQueries({ queryKey: ['subs'] });
    void qc.invalidateQueries({ queryKey: ['sub-metrics'] });
    onChanged?.();
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const pause = useMutation({ mutationFn: () => apiPost(`/subscriptions/${id}/pause`, {}), onSuccess: () => { toast.success('Paused'); invalidate(); }, onError: onErr });
  const resume = useMutation({ mutationFn: () => apiPost(`/subscriptions/${id}/resume`, {}), onSuccess: () => { toast.success('Resumed'); invalidate(); }, onError: onErr });
  const cancelEnd = useMutation({ mutationFn: () => apiPost(`/subscriptions/${id}/cancel`, { atPeriodEnd: true }), onSuccess: () => { toast.success('Will cancel at period end'); invalidate(); }, onError: onErr });
  const cancelNow = useMutation({ mutationFn: () => apiPost(`/subscriptions/${id}/cancel`, { atPeriodEnd: false }), onSuccess: () => { toast.success('Cancelled'); invalidate(); }, onError: onErr });
  const change = useMutation({
    mutationFn: () => apiPatch(`/subscriptions/${id}`, { planId: planId || undefined, quantity: qty ? Number(qty) : undefined }),
    onSuccess: () => { toast.success('Updated — applies next cycle'); setChanging(false); setQty(''); setPlanId(''); invalidate(); }, onError: onErr,
  });
  const pay = useMutation({ mutationFn: (invId: string) => apiPost(`/subscriptions/invoices/${invId}/pay`, {}), onSuccess: () => { toast.success('Invoice marked paid'); invalidate(); }, onError: onErr });
  const voidInv = useMutation({ mutationFn: (invId: string) => apiPost(`/subscriptions/invoices/${invId}/void`, {}), onSuccess: () => { toast.success('Invoice voided'); invalidate(); }, onError: onErr });

  if (sub.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (sub.isError || !sub.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Subscription not found.</div>;
  const s = sub.data;
  const ended = ['CANCELLED', 'EXPIRED'].includes(s.status);
  const invoices = s.invoices ?? [];

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{s.subscriptionNo}</span>
            <SubStatusBadge status={s.status} />
            {s.cancelAtPeriodEnd && !ended ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">cancels {fmtDate(s.currentPeriodEnd)}</span> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{s.customerName} · {s.customerEmail}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!ended && s.status !== 'PAUSED' ? <Button variant="outline" size="sm" onClick={() => pause.mutate()} disabled={pause.isPending}><PauseCircle className="mr-1.5 h-4 w-4" /> Pause</Button> : null}
          {s.status === 'PAUSED' ? <Button variant="outline" size="sm" onClick={() => resume.mutate()} disabled={resume.isPending}><PlayCircle className="mr-1.5 h-4 w-4" /> Resume</Button> : null}
          {!ended ? <Button variant="outline" size="sm" onClick={() => setChanging((v) => !v)}><Repeat className="mr-1.5 h-4 w-4" /> Change</Button> : null}
          {!ended && !s.cancelAtPeriodEnd ? <Button variant="outline" size="sm" onClick={() => cancelEnd.mutate()} disabled={cancelEnd.isPending}>End at period</Button> : null}
          {!ended ? <Button variant="destructive" size="sm" onClick={() => cancelNow.mutate()} disabled={cancelNow.isPending}><XCircle className="mr-1.5 h-4 w-4" /> Cancel</Button> : null}
        </div>
      </PaneHeader>

      <PaneBody className="space-y-5 p-5">
        {changing && !ended ? (
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Switch plan</span>
                <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="h-10 rounded-md border bg-background px-2 text-sm">
                  <option value="">Keep current ({s.planName})</option>
                  {(plans.data ?? []).filter((p) => p.status === 'ACTIVE' && p.id !== s.planId).map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price.amountMinor, p.price.currency)}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Quantity</span>
                <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min={1} placeholder={String(s.quantity)} className="h-10 w-24 rounded-md border bg-background px-2 text-sm" />
              </label>
              <Button size="sm" disabled={change.isPending || (!planId && !qty)} onClick={() => change.mutate()}>{change.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Apply</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Changes take effect on the next billing cycle.</p>
          </div>
        ) : null}

        {/* Billing summary tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Amount" value={`${formatMoney(s.amount.amountMinor, s.amount.currency)}`} sub={intervalLabel(s.billingInterval, s.intervalCount)} />
          <Tile label="MRR" value={formatMoney(s.mrr.amountMinor, s.mrr.currency)} sub={s.collectionMode === 'AUTO' ? 'auto-charge' : 'manual'} />
          <Tile label={ended ? 'Cancelled' : 'Next bill'} value={ended ? fmtDate(s.canceledAt) : fmtDate(s.nextBillingAt)} sub={ended ? '' : timeUntil(s.nextBillingAt)} />
          <Tile label="Period" value={fmtDate(s.currentPeriodStart)} sub={`→ ${fmtDate(s.currentPeriodEnd)}`} tone={s.failedAttempts > 0 ? 'amber' : 'default'} />
        </div>
        {s.status === 'TRIALING' && s.trialEnd ? <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">Free trial until {fmtDate(s.trialEnd)} ({timeUntil(s.trialEnd)}). First invoice generates after the trial.</p> : null}
        {s.failedAttempts > 0 && !ended ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{s.failedAttempts} failed payment attempt(s). The subscription cancels automatically after repeated failures.</p> : null}

        {/* Invoices */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoices</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Period</th><th className="px-3 py-2">Total</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y">
                {invoices.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No invoices yet.</td></tr>
                ) : invoices.map((i: SubInvoice) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5"><div className="font-medium">{i.invoiceNo}</div><div className="text-xs text-muted-foreground">{fmtDate(i.issuedAt)}{i.paymentRef ? ` · ${i.paymentRef}` : ''}</div></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{formatMoney(i.total.amountMinor, i.total.currency)}</td>
                    <td className="px-3 py-2.5"><InvoiceStatusBadge status={i.status} /></td>
                    <td className="px-3 py-2.5 text-right">
                      {i.status === 'OPEN' ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => pay.mutate(i.id)} disabled={pay.isPending} title="Mark paid"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => voidInv.mutate(i.id)} disabled={voidInv.isPending} title="Void"><XCircle className="h-4 w-4 text-muted-foreground" /></Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PaneBody>
    </>
  );
}

function Tile({ label, value, sub = '', tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'amber' }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${tone === 'amber' ? 'text-amber-600' : ''}`}>{value}</p>
      {sub ? <p className="truncate text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
