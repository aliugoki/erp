'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, Target, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import type { CrmAccount, Deal } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { STAGES, StageBadge, fmtDate } from './crm-ui';
import { ActivityTimeline } from './activity-timeline';

export function DealDetail({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const deal = useQuery({ queryKey: ['deal', id], queryFn: () => apiGet<Deal>(`/crm/deals/${id}`) });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<CrmAccount[]>('/crm/clients') });
  const [f, setF] = useState({ title: '', value: '', expectedCloseDate: '', source: '', probability: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    const d = deal.data;
    if (d) setF({ title: d.title, value: d.value.amountMinor ? String(d.value.amountMinor / 100) : '', expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '', source: d.source ?? '', probability: String(d.probability) });
  }, [deal.data]);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['deal', id] }); void qc.invalidateQueries({ queryKey: ['deals'] }); void qc.invalidateQueries({ queryKey: ['pipeline'] }); };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const save = useMutation({
    mutationFn: () => apiPatch(`/crm/deals/${id}`, { title: f.title, valueMinor: f.value ? Math.round(Number(f.value) * 100) : undefined, expectedCloseDate: f.expectedCloseDate ? new Date(f.expectedCloseDate).toISOString() : undefined, source: f.source || undefined, probability: f.probability ? Number(f.probability) : undefined }),
    onSuccess: () => { toast.success('Deal saved'); invalidate(); }, onError: onErr,
  });
  const changeStage = useMutation({
    mutationFn: (vars: { stage: string; lostReason?: string }) => apiPatch(`/crm/deals/${id}/stage`, vars),
    onSuccess: (_d, vars) => { toast.success(`Moved to ${vars.stage.replace('_', ' ')}`); invalidate(); }, onError: onErr,
  });
  const remove = useMutation({ mutationFn: () => apiDelete(`/crm/deals/${id}`), onSuccess: () => { toast.success('Deal deleted'); invalidate(); onDeleted?.(); }, onError: onErr });

  if (deal.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (deal.isError || !deal.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Deal not found.</div>;
  const d = deal.data;
  const account = (accounts.data ?? []).find((a) => a.id === d.clientId);
  const closed = d.stage === 'CLOSED_WON' || d.stage === 'CLOSED_LOST';

  const onStage = (stage: string) => {
    if (stage === d.stage) return;
    if (stage === 'CLOSED_LOST') { const reason = prompt('Reason for losing this deal? (optional)') ?? undefined; changeStage.mutate({ stage, lostReason: reason || undefined }); }
    else changeStage.mutate({ stage });
  };

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><Target className="h-4 w-4 text-primary" /><span className="truncate font-semibold">{d.title}</span><StageBadge stage={d.stage} /></div>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this deal?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Account" value={account?.companyName ?? '—'} />
          <Tile label="Value" value={formatMoney(d.value.amountMinor, d.value.currency)} />
          <Tile label="Weighted" value={formatMoney(d.weighted.amountMinor, d.weighted.currency)} sub={`${d.probability}% prob.`} />
          <Tile label="Close date" value={fmtDate(d.expectedCloseDate)} />
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stage</h3>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((st) => (
              <button key={st} type="button" onClick={() => onStage(st)} disabled={changeStage.isPending}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${st === d.stage ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </section>

        <section className="grid max-w-xl grid-cols-2 gap-4">
          <Field label="Title" className="col-span-2"><Input value={f.title} onChange={set('title')} /></Field>
          <Field label="Value"><Input value={f.value} onChange={set('value')} type="number" min={0} step="0.01" /></Field>
          <Field label="Probability %"><Input value={f.probability} onChange={set('probability')} type="number" min={0} max={100} disabled={closed} /></Field>
          <Field label="Expected close"><Input value={f.expectedCloseDate} onChange={set('expectedCloseDate')} type="date" /></Field>
          <Field label="Source"><Input value={f.source} onChange={set('source')} /></Field>
          <div className="col-span-2"><Button disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </section>

        <div className="border-t pt-4"><ActivityTimeline link={{ dealId: id }} /></div>
      </PaneBody>
    </>
  );
}

function Tile({ label, value, sub = '' }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p>{sub ? <p className="truncate text-[11px] text-muted-foreground">{sub}</p> : null}</div>;
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
