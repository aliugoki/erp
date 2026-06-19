'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Globe, Loader2, Mail, Phone, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import type { CrmAccount } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { AccountStatusBadge } from './crm-ui';
import { ContactsCard } from './contacts-card';
import { ActivityTimeline } from './activity-timeline';

const STATUSES = ['PROSPECT', 'ACTIVE', 'INACTIVE'];

export function AccountDetail({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const acct = useQuery({ queryKey: ['account', id], queryFn: () => apiGet<CrmAccount>(`/crm/clients/${id}`) });
  const [f, setF] = useState({ companyName: '', status: 'PROSPECT', industry: '', website: '', phone: '', email: '', address: '', city: '', country: '', annualRevenue: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    const a = acct.data;
    if (a) setF({ companyName: a.companyName, status: a.status, industry: a.industry ?? '', website: a.website ?? '', phone: a.phone ?? '', email: a.email ?? '', address: a.address ?? '', city: a.city ?? '', country: a.country ?? '', annualRevenue: a.annualRevenueMinor ? String(Number(a.annualRevenueMinor) / 100) : '' });
  }, [acct.data]);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['account', id] }); void qc.invalidateQueries({ queryKey: ['accounts'] }); };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const save = useMutation({
    mutationFn: () => apiPatch(`/crm/clients/${id}`, {
      companyName: f.companyName, status: f.status, industry: f.industry || undefined, website: f.website || undefined,
      phone: f.phone || undefined, email: f.email || undefined, address: f.address || undefined, city: f.city || undefined,
      country: f.country || undefined, annualRevenueMinor: f.annualRevenue ? Math.round(Number(f.annualRevenue) * 100) : undefined,
    }),
    onSuccess: () => { toast.success('Account saved'); invalidate(); }, onError: onErr,
  });
  const remove = useMutation({ mutationFn: () => apiDelete(`/crm/clients/${id}`), onSuccess: () => { toast.success('Account deleted'); invalidate(); onDeleted?.(); }, onError: onErr });

  if (acct.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (acct.isError || !acct.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Account not found.</div>;
  const a = acct.data;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><Building2 className="h-4 w-4 text-primary" /><span className="truncate font-semibold">{a.companyName}</span><AccountStatusBadge status={a.status} /></div>
        {a.accountNo ? <span className="font-mono text-xs text-muted-foreground">{a.accountNo}</span> : null}
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this account and its contacts?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Company" className="col-span-2"><Input value={f.companyName} onChange={set('companyName')} /></Field>
          <Field label="Status"><select value={f.status} onChange={set('status')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Industry"><Input value={f.industry} onChange={set('industry')} /></Field>
          <Field label="Website"><Input value={f.website} onChange={set('website')} placeholder="https://" /></Field>
          <Field label="Annual revenue"><Input value={f.annualRevenue} onChange={set('annualRevenue')} type="number" min={0} step="0.01" /></Field>
          <Field label="Email"><Input value={f.email} onChange={set('email')} type="email" /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Address" className="col-span-2"><Input value={f.address} onChange={set('address')} /></Field>
          <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
          <Field label="Country"><Input value={f.country} onChange={set('country')} /></Field>
          <div className="col-span-2 flex items-center gap-3">
            <Button disabled={!f.companyName.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button>
            {a.website ? <a href={a.website.startsWith('http') ? a.website : `https://${a.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Globe className="h-3 w-3" /> Visit site</a> : null}
            {a.email ? <a href={`mailto:${a.email}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Mail className="h-3 w-3" /> Email</a> : null}
            {a.phone ? <a href={`tel:${a.phone}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Phone className="h-3 w-3" /> Call</a> : null}
          </div>
        </section>
        <div className="border-t pt-4"><ContactsCard clientId={id} /></div>
        <div className="border-t pt-4"><ActivityTimeline link={{ clientId: id }} /></div>
      </PaneBody>
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
