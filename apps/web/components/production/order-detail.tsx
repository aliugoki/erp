'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2, PackageMinus, Save, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { ProductionOrder } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { ProdBadge, PriorityBadge, fmtDate } from './prod-ui';

export function OrderDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['prod-order', id], queryFn: () => apiGet<ProductionOrder>(`/production/orders/${id}`) });
  const [f, setF] = useState({ priority: 'NORMAL', overheadPct: '', plannedStart: '', plannedEnd: '', notes: '' });

  useEffect(() => {
    const o = order.data;
    if (o) setF({ priority: o.priority, overheadPct: String(o.overheadPct), plannedStart: o.plannedStart?.slice(0, 10) ?? '', plannedEnd: o.plannedEnd?.slice(0, 10) ?? '', notes: o.notes ?? '' });
  }, [order.data]);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['prod-order', id] }); void qc.invalidateQueries({ queryKey: ['prod-orders'] }); };

  const MSG: Record<string, string> = {
    plan: 'Order planned',
    release: 'Order released',
    issue: 'Materials issued',
    complete: 'Order completed — finished goods received',
    cancel: 'Order cancelled',
  };
  const act = useMutation({
    mutationFn: (path: string) => apiPost(`/production/orders/${id}/${path}`, {}),
    onSuccess: (_data, path) => { toast.success(MSG[path] ?? 'Done'); invalidate(); },
    onError: onErr,
  });
  const save = useMutation({
    mutationFn: () => apiPatch(`/production/orders/${id}`, { priority: f.priority, overheadPct: Number(f.overheadPct), plannedStart: f.plannedStart || undefined, plannedEnd: f.plannedEnd || undefined, notes: f.notes || undefined }),
    onSuccess: () => { toast.success('Order saved'); invalidate(); },
    onError: onErr,
  });

  if (order.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (order.isError || !order.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Order not found.</div>;
  const o = order.data;
  const currency = o.totalCost.currency;
  const busy = act.isPending;

  const canPlan = o.status === 'DRAFT';
  const canRelease = o.status === 'DRAFT' || o.status === 'PLANNED';
  const canRun = o.status === 'RELEASED' || o.status === 'IN_PROGRESS';
  const closed = o.status === 'COMPLETED' || o.status === 'CANCELLED';

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{o.orderNo}</span>
          <ProdBadge status={o.status} />
          <PriorityBadge priority={o.priority} />
        </div>
        {canPlan ? <Button variant="outline" size="sm" disabled={busy} onClick={() => act.mutate('plan')}><ClipboardList className="mr-1.5 h-4 w-4" /> Plan</Button> : null}
        {canRelease ? <Button variant="outline" size="sm" disabled={busy} onClick={() => act.mutate('release')}><Send className="mr-1.5 h-4 w-4" /> Release</Button> : null}
        {canRun ? <Button variant="outline" size="sm" disabled={busy} onClick={() => act.mutate('issue')}><PackageMinus className="mr-1.5 h-4 w-4" /> Issue materials</Button> : null}
        {canRun ? <Button size="sm" disabled={busy} onClick={() => act.mutate('complete')}><CheckCircle2 className="mr-1.5 h-4 w-4" /> Complete</Button> : null}
        {!closed ? <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => act.mutate('cancel')}><X className="mr-1.5 h-4 w-4" /> Cancel</Button> : null}
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Material" value={formatMoney(o.materialCost.amountMinor, currency)} />
          <Tile label="Operation" value={formatMoney(o.operationCost.amountMinor, currency)} />
          <Tile label="Overhead" value={formatMoney(o.overhead.amountMinor, currency)} />
          <Tile label="Total" value={formatMoney(o.totalCost.amountMinor, currency)} />
          <Tile label="Unit" value={formatMoney(o.unitCost.amountMinor, currency)} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Product" value={o.productName ?? '—'} />
          <Tile label="Planned qty" value={String(o.plannedQty)} />
          <Tile label="Produced qty" value={String(o.producedQty)} />
          <Tile label="Dates" value={`${fmtDate(o.plannedStart)} → ${fmtDate(o.plannedEnd)}`} />
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materials</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Component</th><th className="px-4 py-2 text-right">Required</th><th className="px-4 py-2 text-right">Issued</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Unit cost</th><th className="px-4 py-2 text-right">Cost</th></tr></thead>
              <tbody className="divide-y">
                {(o.materials ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No materials.</td></tr>
                ) : (
                  (o.materials ?? []).map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2">{m.componentName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.requiredQty}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.issuedQty}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.onHand ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(m.unitCost.amountMinor, currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(m.cost.amountMinor, currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {(o.operations ?? []).length > 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operations</h3>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Seq</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Work center</th><th className="px-4 py-2 text-right">Planned</th><th className="px-4 py-2 text-right">Actual</th><th className="px-4 py-2 text-right">Cost</th></tr></thead>
                <tbody className="divide-y">
                  {(o.operations ?? []).map((op) => (
                    <tr key={op.id}>
                      <td className="px-4 py-2 tabular-nums">{op.sequence}</td>
                      <td className="px-4 py-2">{op.name}</td>
                      <td className="px-4 py-2">{op.workCenterName ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{op.plannedMinutes}m</td>
                      <td className="px-4 py-2 text-right tabular-nums">{op.actualMinutes}m</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(op.cost.amountMinor, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {(o.attributes ?? []).filter((a) => a.value).length > 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attributes</h3>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {(o.attributes ?? []).filter((a) => a.value).map((a) => (
                    <tr key={a.attributeId}>
                      <td className="px-4 py-2 text-muted-foreground">{a.label}</td>
                      <td className="px-4 py-2 text-right">{a.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {!closed ? (
          <section className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label="Priority">
              <select value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                <option value="LOW">LOW</option>
                <option value="NORMAL">NORMAL</option>
                <option value="HIGH">HIGH</option>
                <option value="URGENT">URGENT</option>
              </select>
            </Field>
            <Field label="Overhead %"><Input value={f.overheadPct} onChange={(e) => setF((s) => ({ ...s, overheadPct: e.target.value }))} type="number" min={0} step="0.01" /></Field>
            <Field label="Planned start"><Input value={f.plannedStart} onChange={(e) => setF((s) => ({ ...s, plannedStart: e.target.value }))} type="date" /></Field>
            <Field label="Planned end"><Input value={f.plannedEnd} onChange={(e) => setF((s) => ({ ...s, plannedEnd: e.target.value }))} type="date" /></Field>
            <Field label="Notes" className="col-span-2"><textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} rows={3} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" /></Field>
            <div className="col-span-2"><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
          </section>
        ) : null}
      </PaneBody>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</p></div>;
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
