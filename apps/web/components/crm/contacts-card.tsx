'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Phone, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { CrmContact } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Contacts for an account — list, add, set-primary, and delete (full CRUD). */
export function ContactsCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  const contacts = useQuery({ queryKey: ['crm-contacts', clientId], queryFn: () => apiGet<CrmContact[]>(`/crm/clients/${clientId}/contacts`) });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['crm-contacts', clientId] });
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const create = useMutation({
    mutationFn: () => apiPost('/crm/contacts', { clientId, name: f.name, email: f.email || undefined, phone: f.phone || undefined, isPrimary: (contacts.data ?? []).length === 0 }),
    onSuccess: () => { toast.success('Contact added'); setF({ name: '', email: '', phone: '' }); setAdding(false); invalidate(); }, onError: onErr,
  });
  const setPrimary = useMutation({ mutationFn: (id: string) => apiPatch(`/crm/contacts/${id}`, { isPrimary: true }), onSuccess: () => { invalidate(); }, onError: onErr });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/crm/contacts/${id}`), onSuccess: () => { toast.success('Contact removed'); invalidate(); }, onError: onErr });

  const list = contacts.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacts</h3>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}><Plus className="mr-1.5 h-4 w-4" /> Add</Button>
      </div>
      {adding ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
          <Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Name" className="h-9 min-w-[8rem] flex-1" />
          <Input value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} placeholder="Email" type="email" className="h-9 min-w-[8rem] flex-1" />
          <Input value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} placeholder="Phone" className="h-9 w-36" />
          <Button size="sm" disabled={!f.name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}</Button>
        </div>
      ) : null}
      {contacts.isLoading ? <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>
        : list.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No contacts yet.</p>
        : (
          <ul className="space-y-2">
            {list.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">{c.name}{c.isPrimary ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> : null}</p>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{c.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span> : null}{c.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span> : null}</p>
                </div>
                {!c.isPrimary ? <Button variant="ghost" size="icon" onClick={() => setPrimary.mutate(c.id)} disabled={setPrimary.isPending} title="Make primary"><Star className="h-4 w-4 text-muted-foreground" /></Button> : null}
                <Button variant="ghost" size="icon" onClick={() => remove.mutate(c.id)} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
