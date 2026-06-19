'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2, PauseCircle, PlayCircle, Repeat, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { SubInvoice, SubPlan, Subscription } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { InvoiceStatusBadge, SubStatusBadge, fmtDate, intervalLabel, timeUntil } from '@/components/subscriptions/ui';

export default function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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

  if (sub.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (sub.isError || !sub.data) return <div className="py-20 text-center text-muted-foreground">Subscription not found. <Link href="/subscriptions" className="underline">Back</Link></div>;
  const s = sub.data;
  const ended = ['CANCELLED', 'EXPIRED'].includes(s.status);
  const invoices = s.invoices ?? [];

  return (
    <div className="space-y-6">
      <Link href="/subscriptions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Subscriptions</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{s.subscriptionNo}</h1>
            <SubStatusBadge status={s.status} />
            {s.cancelAtPeriodEnd && !ended ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">cancels {fmtDate(s.currentPeriodEnd)}</span> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{s.customerName} · {s.customerEmail}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!ended && s.status !== 'PAUSED' ? <Button variant="outline" size="sm" onClick={() => pause.mutate()} disabled={pause.isPending}><PauseCircle className="mr-2 h-4 w-4" /> Pause</Button> : null}
          {s.status === 'PAUSED' ? <Button variant="outline" size="sm" onClick={() => resume.mutate()} disabled={resume.isPending}><PlayCircle className="mr-2 h-4 w-4" /> Resume</Button> : null}
          {!ended ? <Button variant="outline" size="sm" onClick={() => setChanging((v) => !v)}><Repeat className="mr-2 h-4 w-4" /> Change</Button> : null}
          {!ended && !s.cancelAtPeriodEnd ? <Button variant="outline" size="sm" onClick={() => cancelEnd.mutate()} disabled={cancelEnd.isPending}>Cancel at period end</Button> : null}
          {!ended ? <Button variant="destructive" size="sm" onClick={() => cancelNow.mutate()} disabled={cancelNow.isPending}><XCircle className="mr-2 h-4 w-4" /> Cancel now</Button> : null}
        </div>
      </div>

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
            <p className="text-xs text-muted-foreground">Changes take effect on the next billing cycle.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Invoices */}
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Invoices</h2>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-2">Invoice</th><th className="px-4 py-2">Period</th><th className="px-4 py-2">Total</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y">
                {invoices.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No invoices yet.</td></tr>
                ) : invoices.map((i: SubInvoice) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5"><div className="font-medium">{i.invoiceNo}</div><div className="text-xs text-muted-foreground">{fmtDate(i.issuedAt)}{i.paymentRef ? ` · ${i.paymentRef}` : ''}</div></td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatMoney(i.total.amountMinor, i.total.currency)}{i.tax.amountMinor > 0 ? <span className="block text-[11px] text-muted-foreground">incl. {formatMoney(i.tax.amountMinor, i.tax.currency)} tax</span> : null}</td>
                    <td className="px-4 py-2.5"><InvoiceStatusBadge status={i.status} /></td>
                    <td className="px-4 py-2.5 text-right">
                      {i.status === 'OPEN' ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => pay.mutate(i.id)} disabled={pay.isPending} title="Mark paid"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => voidInv.mutate(i.id)} disabled={voidInv.isPending} title="Void"><XCircle className="h-4 w-4 text-muted-foreground" /></Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Billing summary */}
        <div className="space-y-3 rounded-xl border p-4 text-sm">
          <h2 className="text-sm font-semibold text-muted-foreground">Billing</h2>
          <Row label="Plan" value={s.planName ?? '—'} />
          <Row label="Price" value={`${formatMoney(s.amount.amountMinor, s.amount.currency)} · ${intervalLabel(s.billingInterval, s.intervalCount)}`} />
          {s.quantity > 1 ? <Row label="Quantity" value={`×${s.quantity}`} /> : null}
          <Row label="Collection" value={s.collectionMode === 'AUTO' ? 'Auto-charge' : 'Manual'} />
          <Row label="MRR" value={formatMoney(s.mrr.amountMinor, s.mrr.currency)} />
          <div className="my-2 border-t" />
          <Row label="Started" value={fmtDate(s.startDate)} />
          {s.trialEnd && s.status === 'TRIALING' ? <Row label="Trial ends" value={`${fmtDate(s.trialEnd)} (${timeUntil(s.trialEnd)})`} /> : null}
          <Row label="Current period" value={`${fmtDate(s.currentPeriodStart)} – ${fmtDate(s.currentPeriodEnd)}`} />
          {!ended ? <Row label="Next bill" value={`${fmtDate(s.nextBillingAt)} (${timeUntil(s.nextBillingAt)})`} /> : <Row label="Cancelled" value={fmtDate(s.canceledAt)} />}
          {s.failedAttempts > 0 ? <Row label="Failed attempts" value={String(s.failedAttempts)} tone="amber" /> : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${tone === 'amber' ? 'text-amber-600' : ''}`}>{value}</span>
    </div>
  );
}
