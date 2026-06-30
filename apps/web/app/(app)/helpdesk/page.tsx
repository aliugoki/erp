'use client';
import { ModuleTitle } from '@/components/module-title';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Inbox, LifeBuoy, Loader2, Plus, Search, Star, Tag, Users2, UserX, Wand2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { HdAgent, HdOverview, HdTicket } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { PriorityBadge, SlaPill, StatusBadge, timeAgo } from '@/components/helpdesk/ui';
import { TicketDetail } from '@/components/helpdesk/ticket-detail';
import { SlaTab, TeamsTab, CannedTab } from '@/components/helpdesk/settings-dialog';
import { NewTicketDialog } from '@/components/helpdesk/new-ticket-dialog';

type Section = 'tickets' | 'teams' | 'sla' | 'canned';
const STATUSES = ['NEW', 'OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export default function HelpdeskPage() {
  const [section, setSection] = useState<Section>('tickets');
  const [sel, setSel] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [q, setQ] = useState('');
  const [flag, setFlag] = useState<'' | 'unassigned' | 'breached'>('');
  const [newOpen, setNewOpen] = useState(false);

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
    enabled: section === 'tickets',
  });

  const o = overview.data;
  const list = tickets.data ?? [];
  const pick = (s: Section) => { setSection(s); setSel(null); };
  const clear = () => setSel(null);
  const showDetail = (section === 'tickets' && !!sel) || section !== 'tickets';

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
      <RailItem icon={LifeBuoy} label="Tickets" count={section === 'tickets' ? list.length || undefined : undefined} active={section === 'tickets'} onClick={() => pick('tickets')} />
      <div className="my-1 border-t" />
      <RailItem icon={Users2} label="Teams" active={section === 'teams'} onClick={() => pick('teams')} tone="sky" />
      <RailItem icon={Wand2} label="SLA policies" active={section === 'sla'} onClick={() => pick('sla')} tone="amber" />
      <RailItem icon={Tag} label="Canned replies" active={section === 'canned'} onClick={() => pick('canned')} tone="violet" />
    </div>
  );

  const listPane = (
    <Pane>
      {section === 'tickets' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search #, subject, email…" className="h-9 w-full pl-9" /></div>
            <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New</Button>
          </PaneHeader>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
            <Sel value={status} onChange={setStatus} all="Status" opts={STATUSES} />
            <Sel value={priority} onChange={setPriority} all="Priority" opts={PRIORITIES} />
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="">Anyone</option>{(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}</select>
            {flag ? <button type="button" onClick={() => setFlag('')} className="text-xs text-muted-foreground underline">clear {flag}</button> : null}
          </div>
          <PaneBody>
            {tickets.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              : list.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground"><Inbox className="mx-auto mb-2 h-6 w-6" />No tickets match.</p>
              : (
                <ul className="divide-y">{list.map((t) => (
                  <li key={t.id}><ListRow active={sel === t.id} onClick={() => setSel(t.id)}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="truncate font-medium">{t.subject}</span><PriorityBadge priority={t.priority} /></div>
                      <div className="truncate text-xs text-muted-foreground">{t.ticketNo} · {t.requesterName} · {timeAgo(t.lastActivityAt)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1"><StatusBadge status={t.status} /><SlaPill ticket={t} /></div>
                  </ListRow></li>
                ))}</ul>
              )}
          </PaneBody>
        </>
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium capitalize">{section}</span></PaneHeader><PaneBody><div className="p-2"><ListRow active><LifeBuoy className="h-4 w-4 text-primary" /><span className="flex-1 font-medium capitalize">{section}</span></ListRow></div></PaneBody></>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'tickets' ? (sel ? <TicketDetail id={sel} onBack={clear} /> : <EmptyDetail icon={LifeBuoy} title="Select a ticket" hint="Reply, change status/priority/assignee, and track SLA." />)
        : section === 'teams' ? <SettingsPane title="Teams"><TeamsTab agents={agents.data ?? []} /></SettingsPane>
        : section === 'sla' ? <SettingsPane title="SLA policies"><SlaTab /></SettingsPane>
        : <SettingsPane title="Canned replies"><CannedTab /></SettingsPane>}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <ModuleTitle>Help Desk</ModuleTitle>
        <p className="text-sm text-muted-foreground">Support tickets with SLA tracking, assignment, teams, and a customer portal.</p>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open tickets" value={o?.open ?? 0} icon={Inbox} onClick={() => { setSection('tickets'); setStatus(''); setFlag(''); }} />
        <Stat label="Unassigned" value={o?.unassigned ?? 0} icon={UserX} tone="amber" onClick={() => { setSection('tickets'); setFlag('unassigned'); }} />
        <Stat label="SLA breached" value={o?.breached ?? 0} icon={AlertTriangle} tone="rose" onClick={() => { setSection('tickets'); setFlag('breached'); }} />
        <Stat label="CSAT" value={o?.csatAvg ?? 0} suffix={o?.csatCount ? ` (${o.csatCount})` : ''} icon={Star} tone="emerald" />
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={listPane} detail={detail} showDetail={showDetail} /></div>
      {newOpen ? <NewTicketDialog agents={agents.data ?? []} onClose={() => setNewOpen(false)} /> : null}
    </div>
  );
}

function SettingsPane({ title, children }: { title: string; children: React.ReactNode }) {
  return <><PaneHeader><span className="font-semibold">{title}</span></PaneHeader><PaneBody className="p-5">{children}</PaneBody></>;
}
function Stat({ label, value, suffix = '', icon: Icon, tone = 'default', onClick }: { label: string; value: number; suffix?: string; icon: typeof Inbox; tone?: 'default' | 'amber' | 'rose' | 'emerald'; onClick?: () => void }) {
  const tones: Record<string, string> = { default: 'text-primary', amber: 'text-amber-600', rose: 'text-rose-600', emerald: 'text-emerald-600' };
  return (
    <button type="button" onClick={onClick} className="rounded-xl border p-4 text-left transition hover:shadow-sm">
      <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tones[tone]}`} /></div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}{suffix}</p>
    </button>
  );
}
function Sel({ value, onChange, all, opts }: { value: string; onChange: (v: string) => void; all: string; opts: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">
      <option value="">{all}</option>
      {opts.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
    </select>
  );
}
