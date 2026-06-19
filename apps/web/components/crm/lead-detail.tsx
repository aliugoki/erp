'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, Sparkles, Trash2, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import type { Lead } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { LEAD_STATUSES, LeadStatusBadge, RATINGS, RatingBadge } from './crm-ui';
import { ActivityTimeline } from './activity-timeline';
import { ConvertLeadDialog } from './convert-lead-dialog';

export function LeadDetail({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const lead = useQuery({ queryKey: ['lead', id], queryFn: () => apiGet<Lead>(`/crm/leads/${id}`) });
  const [convertOpen, setConvertOpen] = useState(false);
  const [f, setF] = useState({ name: '', company: '', email: '', phone: '', source: '', rating: 'WARM', estValue: '', notes: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    const l = lead.data;
    if (l) setF({ name: l.name, company: l.company ?? '', email: l.email ?? '', phone: l.phone ?? '', source: l.source ?? '', rating: l.rating, estValue: l.estValue.amountMinor ? String(l.estValue.amountMinor / 100) : '', notes: l.notes ?? '' });
  }, [lead.data]);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['lead', id] }); void qc.invalidateQueries({ queryKey: ['leads'] }); };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const save = useMutation({
    mutationFn: () => apiPatch(`/crm/leads/${id}`, { name: f.name, company: f.company || undefined, email: f.email || undefined, phone: f.phone || undefined, source: f.source || undefined, rating: f.rating, estValueMinor: f.estValue ? Math.round(Number(f.estValue) * 100) : undefined, notes: f.notes || undefined }),
    onSuccess: () => { toast.success('Lead saved'); invalidate(); }, onError: onErr,
  });
  const setStatus = useMutation({ mutationFn: (status: string) => apiPatch(`/crm/leads/${id}/status`, { status }), onSuccess: () => { invalidate(); }, onError: onErr });
  const remove = useMutation({ mutationFn: () => apiDelete(`/crm/leads/${id}`), onSuccess: () => { toast.success('Lead deleted'); invalidate(); onDeleted?.(); }, onError: onErr });

  if (lead.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (lead.isError || !lead.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Lead not found.</div>;
  const l = lead.data;
  const converted = l.status === 'CONVERTED';

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" /><span className="truncate font-semibold">{l.name}</span><LeadStatusBadge status={l.status} /><RatingBadge rating={l.rating} /></div>
        {!converted ? <Button size="sm" onClick={() => setConvertOpen(true)}><UserCheck className="mr-1.5 h-4 w-4" /> Convert</Button> : null}
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this lead?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        {converted ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Converted{l.convertedAt ? ` on ${new Date(l.convertedAt).toLocaleDateString()}` : ''}. {l.convertedClientId ? 'An account was created.' : ''}{l.convertedDealId ? ' An opportunity was opened.' : ''}</p> : null}
        <section className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Name"><Input value={f.name} onChange={set('name')} disabled={converted} /></Field>
          <Field label="Company"><Input value={f.company} onChange={set('company')} disabled={converted} /></Field>
          <Field label="Email"><Input value={f.email} onChange={set('email')} type="email" disabled={converted} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={set('phone')} disabled={converted} /></Field>
          <Field label="Source"><Input value={f.source} onChange={set('source')} disabled={converted} /></Field>
          <Field label="Est. value"><Input value={f.estValue} onChange={set('estValue')} type="number" min={0} step="0.01" disabled={converted} /></Field>
          <Field label="Rating"><select value={f.rating} onChange={set('rating')} disabled={converted} className="h-10 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60">{RATINGS.map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Status">
            <select value={l.status === 'CONVERTED' ? 'CONVERTED' : l.status} onChange={(e) => setStatus.mutate(e.target.value)} disabled={converted} className="h-10 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60">
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              {converted ? <option value="CONVERTED">CONVERTED</option> : null}
            </select>
          </Field>
          <Field label="Notes" className="col-span-2"><textarea value={f.notes} onChange={set('notes')} disabled={converted} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60" /></Field>
          {!converted ? <div className="col-span-2"><Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div> : null}
        </section>
        <div className="border-t pt-4"><ActivityTimeline link={{ leadId: id }} /></div>
      </PaneBody>
      {convertOpen ? <ConvertLeadDialog lead={l} onClose={() => { setConvertOpen(false); invalidate(); }} /> : null}
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
