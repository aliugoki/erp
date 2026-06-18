'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Inbox, Loader2, Plus, Search, Settings2, Star, UserX } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { HdAgent, HdOverview, HdTicket } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PriorityBadge, SlaPill, StatusBadge, timeAgo } from '@/components/helpdesk/ui';
import { NewTicketDialog } from '@/components/helpdesk/new-ticket-dialog';
import { HelpdeskSettings } from '@/components/helpdesk/settings-dialog';

const STATUSES = ['NEW', 'OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export default function HelpdeskPage() {
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [q, setQ] = useState('');
  const [flag, setFlag] = useState<'' | 'unassigned' | 'breached'>('');
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const overview = useQuery({ queryKey: ['hd-overview'], queryFn: () => apiGet<HdOverview>('/helpdesk/overview') });
  const agents = useQuery({ queryKey: ['hd-agents'], queryFn: () => apiGet<HdAgent[]>('/helpdesk/agents') });
  const tickets = useQuery({
    queryKey: ['hd-tickets', status, priority, assignedTo, q, flag],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (priority) qs.set('priority', priority);
      if (assignedTo) qs.set('assignedTo', assignedTo);
      if (q) qs.set('q', q);
      if (flag) qs.set(flag, 'true');
      return apiGet<HdTicket[]>(`/helpdesk/tickets${qs.toString() ? `?${qs}` : ''}`);
    },
  });

  const o = overview.data;
  const list = tickets.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Help Desk</h1>
          <p className="text-sm text-muted-foreground">Support tickets with SLA tracking, assignment, and a customer portal.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}><Settings2 className="mr-2 h-4 w-4" /> Settings</Button>
          <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="mr-2 h-4 w-4" /> New ticket</Button>
        </div>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open tickets" value={o?.open ?? 0} icon={Inbox} onClick={() => { setStatus(''); setFlag(''); }} />
        <Stat label="Unassigned" value={o?.unassigned ?? 0} icon={UserX} tone="amber" onClick={() => setFlag('unassigned')} />
        <Stat label="SLA breached" value={o?.breached ?? 0} icon={AlertTriangle} tone="rose" onClick={() => setFlag('breached')} />
        <Stat label="CSAT" value={o?.csatAvg ?? 0} suffix={o?.csatCount ? ` (${o.csatCount})` : ''} icon={Star} tone="emerald" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, #, email…" className="w-56 pl-9" />
        </div>
        <Sel value={status} onChange={setStatus} all="All statuses" opts={STATUSES} />
        <Sel value={priority} onChange={setPriority} all="All priorities" opts={PRIORITIES} />
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">All assignees</option>
          {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
        </select>
        {flag ? <Button variant="ghost" size="sm" onClick={() => setFlag('')}>Clear “{flag}”</Button> : null}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">Ticket</th><th className="px-4 py-2">Requester</th><th className="px-4 py-2">Priority</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">SLA</th><th className="px-4 py-2">Assignee</th><th className="px-4 py-2 text-right">Updated</th></tr>
          </thead>
          <tbody className="divide-y">
            {tickets.isLoading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground"><Inbox className="mx-auto mb-2 h-6 w-6" />No tickets match.</td></tr>
            ) : (
              list.map((t) => (
                <tr key={t.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/helpdesk/${t.id}`} className="block">
                      <span className="font-medium text-foreground hover:underline">{t.subject}</span>
                      <span className="block text-xs text-muted-foreground">{t.ticketNo}{t.messageCount ? ` · ${t.messageCount} msgs` : ''}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5"><div>{t.requesterName}</div><div className="text-xs text-muted-foreground">{t.requesterEmail}</div></td>
                  <td className="px-4 py-2.5"><PriorityBadge priority={t.priority} /></td>
                  <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-2.5"><SlaPill ticket={t} /></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{t.assigneeName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{timeAgo(t.lastActivityAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {newOpen ? <NewTicketDialog agents={agents.data ?? []} onClose={() => setNewOpen(false)} /> : null}
      {settingsOpen ? <HelpdeskSettings agents={agents.data ?? []} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

function Stat({ label, value, suffix = '', icon: Icon, tone = 'default', onClick }: { label: string; value: number; suffix?: string; icon: typeof Inbox; tone?: 'default' | 'amber' | 'rose' | 'emerald'; onClick?: () => void }) {
  const tones: Record<string, string> = { default: 'text-primary', amber: 'text-amber-600', rose: 'text-rose-600', emerald: 'text-emerald-600' };
  return (
    <button type="button" onClick={onClick} className="rounded-xl border p-4 text-left transition hover:shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${tones[tone]}`} />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}{suffix}</p>
    </button>
  );
}

function Sel({ value, onChange, all, opts }: { value: string; onChange: (v: string) => void; all: string; opts: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
      <option value="">{all}</option>
      {opts.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
    </select>
  );
}
