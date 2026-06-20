'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import type { HdAgent, HdCannedResponse, HdSlaPolicy, HdTeam } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const TABS = ['SLA', 'Teams', 'Canned replies'] as const;

export function HelpdeskSettings({ agents, onClose }: { agents: HdAgent[]; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('SLA');
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Help Desk settings</DialogTitle></DialogHeader>
        <div className="mb-4 flex gap-1 border-b">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>{t}</button>
          ))}
        </div>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {tab === 'SLA' ? <SlaTab /> : tab === 'Teams' ? <TeamsTab agents={agents} /> : <CannedTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const DEFAULTS: Record<string, [number, number]> = { URGENT: [30, 240], HIGH: [60, 480], MEDIUM: [240, 1440], LOW: [480, 2880] };

export function SlaTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hd-sla'], queryFn: () => apiGet<HdSlaPolicy[]>('/helpdesk/sla-policies') });
  const save = useMutation({
    mutationFn: (body: { priority: string; firstResponseMins: number; resolutionMins: number }) => apiPut('/helpdesk/sla-policies', body),
    onSuccess: () => { toast.success('SLA saved'); void qc.invalidateQueries({ queryKey: ['hd-sla'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const find = (p: string) => q.data?.find((x) => x.priority === p);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">First-response &amp; resolution targets (minutes) per priority. Unset priorities use sensible defaults.</p>
      {PRIORITIES.map((p) => <SlaRow key={p} priority={p} policy={find(p)} onSave={(fr, res) => save.mutate({ priority: p, firstResponseMins: fr, resolutionMins: res })} />)}
    </div>
  );
}
function SlaRow({ priority, policy, onSave }: { priority: string; policy?: HdSlaPolicy; onSave: (fr: number, res: number) => void }) {
  const [fr, setFr] = useState(String(policy?.firstResponseMins ?? DEFAULTS[priority][0]));
  const [res, setRes] = useState(String(policy?.resolutionMins ?? DEFAULTS[priority][1]));
  return (
    <div className="grid grid-cols-[80px_1fr_1fr_auto] items-center gap-2 rounded-lg border p-2">
      <span className="text-sm font-semibold">{priority}</span>
      <label className="text-xs text-muted-foreground">First resp.<Input value={fr} onChange={(e) => setFr(e.target.value)} inputMode="numeric" className="mt-0.5 h-8" /></label>
      <label className="text-xs text-muted-foreground">Resolution<Input value={res} onChange={(e) => setRes(e.target.value)} inputMode="numeric" className="mt-0.5 h-8" /></label>
      <Button size="sm" variant="outline" onClick={() => onSave(Number(fr) || 1, Number(res) || 1)}>Save</Button>
    </div>
  );
}

export function TeamsTab({ agents }: { agents: HdAgent[] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hd-teams'], queryFn: () => apiGet<HdTeam[]>('/helpdesk/teams') });
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['hd-teams'] });
  const create = useMutation({
    mutationFn: () => apiPost('/helpdesk/teams', { name, memberIds: members }),
    onSuccess: () => { setName(''); setMembers([]); toast.success('Team created'); void invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/helpdesk/teams/${id}`), onSuccess: () => { toast.success('Removed'); void invalidate(); } });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name (e.g. Tier 1)" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {agents.map((a) => {
            const on = members.includes(a.id);
            return <button key={a.id} type="button" onClick={() => setMembers((m) => on ? m.filter((x) => x !== a.id) : [...m, a.id])} className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{a.email}</button>;
          })}
        </div>
        <div className="mt-2 flex justify-end"><Button size="sm" disabled={!name || create.isPending} onClick={() => create.mutate()}><Plus className="mr-1 h-4 w-4" /> Add team</Button></div>
      </div>
      <div className="divide-y rounded-lg border">
        {(q.data ?? []).length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">No teams.</p> : q.data!.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm"><span className="font-medium">{t.name}<span className="ml-2 text-xs text-muted-foreground">{t.memberCount ?? 0} members</span></span><Button size="sm" variant="ghost" onClick={() => remove.mutate(t.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></div>
        ))}
      </div>
    </div>
  );
}

export function CannedTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hd-canned'], queryFn: () => apiGet<HdCannedResponse[]>('/helpdesk/canned-responses') });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['hd-canned'] });
  const create = useMutation({
    mutationFn: () => apiPost('/helpdesk/canned-responses', { title, body }),
    onSuccess: () => { setTitle(''); setBody(''); toast.success('Saved'); void invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/helpdesk/canned-responses/${id}`), onSuccess: () => { toast.success('Removed'); void invalidate(); } });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Password reset steps)" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Reply text…" />
        <div className="mt-2 flex justify-end"><Button size="sm" disabled={!title || !body || create.isPending} onClick={() => create.mutate()}><Plus className="mr-1 h-4 w-4" /> Add reply</Button></div>
      </div>
      <div className="divide-y rounded-lg border">
        {(q.data ?? []).length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">No saved replies.</p> : q.data!.map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm"><div><p className="font-medium">{c.title}</p><p className="line-clamp-2 text-xs text-muted-foreground">{c.body}</p></div><Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></div>
        ))}
      </div>
    </div>
  );
}
