'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2, Save, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Asset, AssetScheduleRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { AssetBadge, fmtDate, methodLabel } from './asset-ui';

export function AssetDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const asset = useQuery({ queryKey: ['asset', id], queryFn: () => apiGet<Asset>(`/assets/${id}`) });
  const [proceeds, setProceeds] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [f, setF] = useState({ name: '', description: '', location: '', serialNo: '', supplier: '', notes: '' });

  const schedule = useQuery({ queryKey: ['asset-schedule', id], queryFn: () => apiGet<AssetScheduleRow[]>(`/assets/${id}/schedule`), enabled: showSchedule });

  useEffect(() => {
    const a = asset.data;
    if (a) setF({ name: a.name, description: a.description ?? '', location: a.location ?? '', serialNo: a.serialNo ?? '', supplier: a.supplier ?? '', notes: a.notes ?? '' });
  }, [asset.data]);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['asset', id] }); void qc.invalidateQueries({ queryKey: ['assets'] }); };

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => apiPost(`/assets/${id}/${path}`, body ?? {}),
    onSuccess: () => { toast.success('Done'); setProceeds(''); invalidate(); },
    onError: onErr,
  });
  const save = useMutation({
    mutationFn: () => apiPatch(`/assets/${id}`, {
      name: f.name,
      description: f.description || undefined,
      location: f.location || undefined,
      serialNo: f.serialNo || undefined,
      supplier: f.supplier || undefined,
      notes: f.notes || undefined,
    }),
    onSuccess: () => { toast.success('Asset saved'); invalidate(); },
    onError: onErr,
  });

  if (asset.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (asset.isError || !asset.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Asset not found.</div>;
  const a = asset.data;
  const cur = a.acquisitionCost.currency;
  const editable = a.status !== 'DISPOSED' && a.status !== 'WRITTEN_OFF';

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{a.assetNo}</span>
          <span className="truncate font-semibold">{a.name}</span>
          <AssetBadge status={a.status} />
        </div>
        {a.status === 'DRAFT' ? (
          <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ path: 'activate' })}><CheckCircle2 className="mr-1.5 h-4 w-4" /> Activate</Button>
        ) : null}
        {a.status === 'ACTIVE' || a.status === 'DRAFT' ? (
          <>
            <Input className="h-8 w-28" type="number" min="0" step="0.01" placeholder="Proceeds" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'dispose', body: { proceedsMinor: Math.round((Number(proceeds) || 0) * 100) } })}>Dispose</Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={act.isPending} onClick={() => act.mutate({ path: 'write-off' })}>Write off</Button>
          </>
        ) : null}
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Acquisition" value={formatMoney(a.acquisitionCost.amountMinor, cur)} />
          <Tile label="Accumulated dep." value={formatMoney(a.accumulatedDepreciation.amountMinor, cur)} />
          <Tile label="Book value" value={formatMoney(a.bookValue.amountMinor, cur)} />
          <Tile label="Salvage" value={formatMoney(a.salvageValue.amountMinor, cur)} />
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Meta label="Category" value={a.categoryName ?? '—'} />
          <Meta label="Method" value={methodLabel(a.method)} />
          <Meta label="Useful life" value={`${a.usefulLifeMonths} mo`} />
          <Meta label="Acquired" value={fmtDate(a.acquisitionDate)} />
          <Meta label="Dep. start" value={fmtDate(a.depreciationStart)} />
          <Meta label="Custodian" value={a.custodianName ?? '—'} />
          <Meta label="Location" value={a.location ?? '—'} />
          <Meta label="Serial" value={a.serialNo ?? '—'} />
          <Meta label="Supplier" value={a.supplier ?? '—'} />
        </div>

        {a.status === 'DISPOSED' || a.status === 'WRITTEN_OFF' ? (
          <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm">
            Disposed {fmtDate(a.disposalDate)} — proceeds {formatMoney(a.disposalProceeds?.amountMinor ?? 0, cur)}
            {a.disposalGain ? (
              <>
                {', '}
                <span className={a.disposalGain.amountMinor >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                  {a.disposalGain.amountMinor >= 0 ? 'gain' : 'loss'} {formatMoney(Math.abs(a.disposalGain.amountMinor), cur)}
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        {editable ? (
          <section className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
            <Field label="Description" className="col-span-2"><textarea value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} rows={2} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" /></Field>
            <Field label="Location"><Input value={f.location} onChange={(e) => setF((s) => ({ ...s, location: e.target.value }))} /></Field>
            <Field label="Serial no"><Input value={f.serialNo} onChange={(e) => setF((s) => ({ ...s, serialNo: e.target.value }))} /></Field>
            <Field label="Supplier" className="col-span-2"><Input value={f.supplier} onChange={(e) => setF((s) => ({ ...s, supplier: e.target.value }))} /></Field>
            <Field label="Notes" className="col-span-2"><textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} rows={2} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" /></Field>
            <div className="col-span-2"><Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
          </section>
        ) : null}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Depreciation history</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowSchedule((s) => !s)}><TrendingDown className="mr-1.5 h-4 w-4" /> {showSchedule ? 'Hide schedule' : 'Preview schedule'}</Button>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Period</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Accumulated</th><th className="px-4 py-2 text-right">Book value</th></tr></thead>
              <tbody className="divide-y">
                {(a.depreciation ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No depreciation posted yet.</td></tr>
                ) : (
                  (a.depreciation ?? []).map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(d.period)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.amount.amountMinor, d.amount.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.accumulatedAfter.amountMinor, d.accumulatedAfter.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.bookValueAfter.amountMinor, d.bookValueAfter.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {showSchedule ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projected schedule</h3>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Period</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Accumulated</th><th className="px-4 py-2 text-right">Book value</th></tr></thead>
                <tbody className="divide-y">
                  {schedule.isLoading ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                  ) : (schedule.data ?? []).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No schedule.</td></tr>
                  ) : (
                    (schedule.data ?? []).map((r) => (
                      <tr key={r.period}>
                        <td className="px-4 py-2 text-muted-foreground">#{r.period}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.amount.amountMinor, r.amount.currency)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.accumulated.amountMinor, r.accumulated.currency)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.bookValue.amountMinor, r.bookValue.currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Maintenance</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2">Vendor</th></tr></thead>
              <tbody className="divide-y">
                {(a.maintenance ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No maintenance recorded.</td></tr>
                ) : (
                  (a.maintenance ?? []).map((mt) => (
                    <tr key={mt.id}>
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(mt.maintDate)}</td>
                      <td className="px-4 py-2">{mt.type}</td>
                      <td className="px-4 py-2">{mt.description ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(mt.cost.amountMinor, mt.cost.currency)}</td>
                      <td className="px-4 py-2">{mt.vendor ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}
function Meta({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col"><span className="text-xs text-muted-foreground">{label}</span><span className="truncate">{value}</span></div>;
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
