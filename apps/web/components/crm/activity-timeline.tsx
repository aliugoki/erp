'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Activity } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ACTIVITY_META, dueLabel, fmtDateTime } from './crm-ui';

type Link = { clientId?: string; leadId?: string; dealId?: string };
const TYPES = ['CALL', 'MEETING', 'EMAIL', 'TASK', 'NOTE'];

/** Activity feed scoped to one entity (account / lead / deal) with quick-add, complete, and delete. */
export function ActivityTimeline({ link }: { link: Link }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ type: 'TASK', subject: '', dueAt: '' });
  const key = link.clientId ?? link.leadId ?? link.dealId ?? 'none';
  const param = link.clientId ? `clientId=${link.clientId}` : link.leadId ? `leadId=${link.leadId}` : `dealId=${link.dealId}`;

  const acts = useQuery({ queryKey: ['crm-acts', key], queryFn: () => apiGet<Activity[]>(`/crm/activities?${param}`) });
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['crm-acts', key] }); void qc.invalidateQueries({ queryKey: ['activities'] }); void qc.invalidateQueries({ queryKey: ['open-tasks'] }); };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const create = useMutation({
    mutationFn: () => apiPost('/crm/activities', { type: f.type, subject: f.subject, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined, ...link }),
    onSuccess: () => { toast.success('Activity logged'); setF({ type: 'TASK', subject: '', dueAt: '' }); setAdding(false); invalidate(); }, onError: onErr,
  });
  const complete = useMutation({ mutationFn: (id: string) => apiPatch(`/crm/activities/${id}/complete`, {}), onSuccess: () => { toast.success('Marked done'); invalidate(); }, onError: onErr });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/crm/activities/${id}`), onSuccess: () => { toast.success('Activity deleted'); invalidate(); }, onError: onErr });

  const list = acts.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}><Plus className="mr-1.5 h-4 w-4" /> Log</Button>
      </div>

      {adding ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
          <select value={f.type} onChange={(e) => setF((s) => ({ ...s, type: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm">
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <Input value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} placeholder="Subject" className="h-9 min-w-[12rem] flex-1" />
          <Input value={f.dueAt} onChange={(e) => setF((s) => ({ ...s, dueAt: e.target.value }))} type="datetime-local" className="h-9 w-48" />
          <Button size="sm" disabled={!f.subject.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}</Button>
        </div>
      ) : null}

      {acts.isLoading ? <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>
        : list.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No activity yet.</p>
        : (
          <ul className="space-y-2">
            {list.map((a) => {
              const meta = ACTIVITY_META[a.type] ?? ACTIVITY_META.NOTE!;
              const Icon = meta.icon;
              const due = dueLabel(a.dueAt);
              return (
                <li key={a.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${a.completed ? 'text-muted-foreground' : meta.tone}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${a.completed ? 'text-muted-foreground line-through' : ''}`}>{a.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.completed ? `Done ${fmtDateTime(a.completedAt)}` : a.dueAt ? <span className={due?.overdue ? 'text-rose-600' : ''}>Due {fmtDateTime(a.dueAt)} · {due?.text}</span> : fmtDateTime(a.createdAt)}
                      {a.outcome ? ` · ${a.outcome}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!a.completed ? <Button variant="ghost" size="icon" onClick={() => complete.mutate(a.id)} disabled={complete.isPending} title="Complete"><Check className="h-4 w-4 text-emerald-600" /></Button> : null}
                    <Button variant="ghost" size="icon" onClick={() => remove.mutate(a.id)} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
