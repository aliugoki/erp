'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Department, Designation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';

interface Position { id: string; title: string; description: string | null }
interface Row { id: string; label: string }

const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

function CrudList<T>({ title, queryKey, path, field, queryFn, toLabel }: {
  title: string;
  queryKey: string;
  path: string;
  field: 'name' | 'title';
  queryFn: () => Promise<T[]>;
  toLabel: (item: T) => Row;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const list = useQuery({ queryKey: [queryKey], queryFn });

  const invalidate = () => { void qc.invalidateQueries({ queryKey: [queryKey] }); };

  const create = useMutation({
    mutationFn: (value: string) => apiPost(path, { [field]: value }),
    onSuccess: () => { setAdding(''); invalidate(); },
    onError: onErr,
  });
  const update = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => apiPatch(`${path}/${id}`, { [field]: value }),
    onSuccess: () => { setEditId(null); invalidate(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`${path}/${id}`),
    onSuccess: invalidate,
    onError: onErr,
  });

  const rows = (list.data ?? []).map(toLabel);

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="overflow-hidden rounded-xl border">
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              {editId === r.id ? (
                <>
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8" />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={update.isPending || !draft.trim()} onClick={() => update.mutate({ id: r.id, value: draft })}><Save className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="font-medium">{r.label}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setEditId(r.id); setDraft(r.label); }}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => { if (confirm(`Delete "${r.label}"?`)) remove.mutate(r.id); }}><Trash2 className="size-4" /></Button>
                  </div>
                </>
              )}
            </li>
          ))}
          {rows.length === 0 ? <li className="px-3 py-4 text-center text-sm text-muted-foreground">None yet.</li> : null}
        </ul>
        <form className="flex gap-2 border-t bg-muted/20 p-2" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) create.mutate(adding.trim()); }}>
          <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={`New ${title.toLowerCase().replace(/s$/, '')}`} className="h-8" />
          <Button type="submit" size="sm" disabled={create.isPending || !adding.trim()}><Plus className="size-4" /> Add</Button>
        </form>
      </div>
    </section>
  );
}

export function OrgPanel() {
  return (
    <>
      <PaneHeader>
        <span className="font-semibold">Organization</span>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <CrudList<Department>
          title="Departments"
          queryKey="departments"
          path="/hr/departments"
          field="name"
          queryFn={() => apiGet<Department[]>('/hr/departments')}
          toLabel={(d) => ({ id: d.id, label: d.name })}
        />
        <CrudList<Designation>
          title="Designations"
          queryKey="designations"
          path="/hr/designations"
          field="name"
          queryFn={() => apiGet<Designation[]>('/hr/designations')}
          toLabel={(d) => ({ id: d.id, label: d.name })}
        />
        <CrudList<Position>
          title="Positions"
          queryKey="positions"
          path="/hr/positions"
          field="title"
          queryFn={() => apiGet<Position[]>('/hr/positions')}
          toLabel={(p) => ({ id: p.id, label: p.title })}
        />
      </PaneBody>
    </>
  );
}
