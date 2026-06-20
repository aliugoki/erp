'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import type { Bom } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { ProdBadge } from './prod-ui';

export function BomDetail({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const bomQ = useQuery({ queryKey: ['prod-bom', id], queryFn: () => apiGet<Bom>(`/production/boms/${id}`) });
  const [f, setF] = useState({ name: '', outputQty: '', overheadPct: '', notes: '' });

  useEffect(() => {
    const b = bomQ.data;
    if (b) setF({ name: b.name, outputQty: String(b.outputQty), overheadPct: String(b.overheadPct), notes: b.notes ?? '' });
  }, [bomQ.data]);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['prod-boms'] }); void qc.invalidateQueries({ queryKey: ['prod-bom', id] }); };

  const setStatus = useMutation({
    mutationFn: (status: string) => apiPatch(`/production/boms/${id}/status`, { status }),
    onSuccess: () => { toast.success('BOM status updated'); invalidate(); },
    onError: onErr,
  });
  const save = useMutation({
    mutationFn: () => apiPatch(`/production/boms/${id}`, { name: f.name, outputQty: Number(f.outputQty), overheadPct: Number(f.overheadPct), notes: f.notes || undefined }),
    onSuccess: () => { toast.success('BOM saved'); invalidate(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/production/boms/${id}`),
    onSuccess: () => { toast.success('BOM deleted'); invalidate(); onDeleted?.(); },
    onError: onErr,
  });

  if (bomQ.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (bomQ.isError || !bomQ.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">BOM not found.</div>;
  const bom = bomQ.data;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{bom.bomNo}</span>
          <span className="truncate text-sm text-muted-foreground">{bom.name}</span>
          <ProdBadge status={bom.status} />
        </div>
        <select value={bom.status} onChange={(e) => setStatus.mutate(e.target.value)} disabled={setStatus.isPending} className="h-9 rounded-md border bg-background px-2 text-sm">
          <option value="DRAFT">DRAFT</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this BOM?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Product" value={bom.productName ?? '—'} />
          <Tile label="Output qty" value={String(bom.outputQty)} />
          <Tile label="Version" value={String(bom.version)} />
          <Tile label="Overhead" value={`${bom.overheadPct}%`} />
        </div>

        <section className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
          <Field label="Output qty"><Input value={f.outputQty} onChange={(e) => setF((s) => ({ ...s, outputQty: e.target.value }))} type="number" min={0} step="0.01" /></Field>
          <Field label="Overhead %"><Input value={f.overheadPct} onChange={(e) => setF((s) => ({ ...s, overheadPct: e.target.value }))} type="number" min={0} step="0.01" /></Field>
          <Field label="Notes" className="col-span-2"><textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} rows={3} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" /></Field>
          <div className="col-span-2"><Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Components</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Component</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Scrap</th><th className="px-4 py-2 text-right">Cost</th></tr></thead>
              <tbody className="divide-y">
                {(bom.lines ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No components.</td></tr>
                ) : (
                  (bom.lines ?? []).map((l, i) => (
                    <tr key={l.id ?? i}>
                      <td className="px-4 py-2">{l.componentName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.scrapPct}%</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.componentCost ? formatMoney(l.componentCost.amountMinor, l.componentCost.currency) : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operations</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Seq</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Work center</th><th className="px-4 py-2 text-right">Run</th></tr></thead>
              <tbody className="divide-y">
                {(bom.operations ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No operations.</td></tr>
                ) : (
                  (bom.operations ?? []).map((op, i) => (
                    <tr key={op.id ?? i}>
                      <td className="px-4 py-2 tabular-nums">{op.sequence}</td>
                      <td className="px-4 py-2">{op.name}</td>
                      <td className="px-4 py-2">{op.workCenterName ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{op.runMinutes}m</td>
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
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
