'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiPatch } from '@/lib/api';
import type { Activity } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { ACTIVITY_META, fmtDateTime } from './crm-ui';

const TYPES = ['CALL', 'MEETING', 'EMAIL', 'TASK', 'NOTE'];

export function ActivityDetail({ activity, onBack, onChanged, onDeleted }: { activity: Activity; onBack?: () => void; onChanged?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ type: activity.type, subject: activity.subject, body: activity.body ?? '', dueAt: activity.dueAt ? activity.dueAt.slice(0, 16) : '', outcome: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => { setF({ type: activity.type, subject: activity.subject, body: activity.body ?? '', dueAt: activity.dueAt ? activity.dueAt.slice(0, 16) : '', outcome: '' }); }, [activity]);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['activities'] }); void qc.invalidateQueries({ queryKey: ['open-tasks'] }); onChanged?.(); };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const save = useMutation({
    mutationFn: () => apiPatch(`/crm/activities/${activity.id}`, { type: f.type, subject: f.subject, body: f.body || undefined, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined }),
    onSuccess: () => { toast.success('Activity saved'); invalidate(); }, onError: onErr,
  });
  const complete = useMutation({ mutationFn: () => apiPatch(`/crm/activities/${activity.id}/complete`, { outcome: f.outcome || undefined }), onSuccess: () => { toast.success('Marked done'); invalidate(); }, onError: onErr });
  const remove = useMutation({ mutationFn: () => apiDelete(`/crm/activities/${activity.id}`), onSuccess: () => { toast.success('Activity deleted'); invalidate(); onDeleted?.(); }, onError: onErr });

  const meta = ACTIVITY_META[activity.type] ?? ACTIVITY_META.NOTE!;
  const Icon = meta.icon;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><Icon className={`h-4 w-4 ${meta.tone}`} /><span className="truncate font-semibold">{activity.subject}</span>{activity.completed ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">DONE</span> : null}</div>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this activity?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">{activity.completed ? `Completed ${fmtDateTime(activity.completedAt)}` : `Created ${fmtDateTime(activity.createdAt)}`}</p>
        <section className="grid max-w-xl grid-cols-2 gap-4">
          <Field label="Type"><select value={f.type} onChange={set('type')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Due"><Input value={f.dueAt} onChange={set('dueAt')} type="datetime-local" /></Field>
          <Field label="Subject" className="col-span-2"><Input value={f.subject} onChange={set('subject')} /></Field>
          <Field label="Notes" className="col-span-2"><textarea value={f.body} onChange={set('body')} rows={4} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></Field>
          <div className="col-span-2 flex items-center gap-2">
            <Button disabled={!f.subject.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button>
            {!activity.completed ? <Button variant="outline" onClick={() => complete.mutate()} disabled={complete.isPending}><Check className="mr-2 h-4 w-4 text-emerald-600" /> Complete</Button> : null}
          </div>
          {!activity.completed ? <Field label="Outcome (on complete)" className="col-span-2"><Input value={f.outcome} onChange={set('outcome')} placeholder="What happened?" /></Field> : activity.outcome ? <div className="col-span-2 text-sm"><span className="text-muted-foreground">Outcome: </span>{activity.outcome}</div> : null}
        </section>
      </PaneBody>
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
