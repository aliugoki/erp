'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Loader2, Lock, Send, Star } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { HdAgent, HdCannedResponse, HdTicket } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { PriorityBadge, SlaPill, StatusBadge, dueLabel, timeAgo } from './ui';

const STATUSES = ['NEW', 'OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

/** Full ticket conversation + agent actions, sized for the three-pane detail column. */
export function TicketDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const ticket = useQuery({ queryKey: ['hd-ticket', id], queryFn: () => apiGet<HdTicket>(`/helpdesk/tickets/${id}`) });
  const agents = useQuery({ queryKey: ['hd-agents'], queryFn: () => apiGet<HdAgent[]>('/helpdesk/agents') });
  const canned = useQuery({ queryKey: ['hd-canned'], queryFn: () => apiGet<HdCannedResponse[]>('/helpdesk/canned-responses') });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);

  const refresh = (t: HdTicket) => { qc.setQueryData(['hd-ticket', id], t); void qc.invalidateQueries({ queryKey: ['hd-tickets'] }); void qc.invalidateQueries({ queryKey: ['hd-overview'] }); };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const action = (path: string) => (b: unknown) => apiPost<HdTicket>(`/helpdesk/tickets/${id}/${path}`, b);
  const reply = useMutation({ mutationFn: action('reply'), onSuccess: (t) => { refresh(t); setBody(''); toast.success(internal ? 'Note added' : 'Reply sent'); }, onError: onErr });
  const status = useMutation({ mutationFn: action('status'), onSuccess: refresh, onError: onErr });
  const assign = useMutation({ mutationFn: action('assign'), onSuccess: refresh, onError: onErr });
  const csat = useMutation({ mutationFn: action('csat'), onSuccess: (t) => { refresh(t); toast.success('Rating saved'); }, onError: onErr });
  const priorityMut = useMutation({ mutationFn: (priority: string) => apiPatch<HdTicket>(`/helpdesk/tickets/${id}`, { priority }), onSuccess: refresh, onError: onErr });

  if (ticket.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (ticket.isError || !ticket.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Ticket not found.</div>;
  const t = ticket.data;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-semibold">{t.subject}</span><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /></div><span className="text-xs text-muted-foreground">{t.ticketNo}</span></div>
        <SlaPill ticket={t} />
      </PaneHeader>
      <PaneBody className="p-5">
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* Conversation */}
          <div className="space-y-4">
            <div className="space-y-3">
              {(t.messages ?? []).map((m) => (
                m.authorType === 'SYSTEM' ? (
                  <p key={m.id} className="text-center text-xs text-muted-foreground">{m.body} · {timeAgo(m.createdAt)}</p>
                ) : (
                  <div key={m.id} className={`rounded-xl border p-3 ${m.isInternal ? 'border-amber-200 bg-amber-50' : m.authorType === 'AGENT' ? 'border-primary/20 bg-primary/5' : 'bg-background'}`}>
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <span className="font-semibold">{m.authorName}</span>
                      <span className="rounded bg-muted px-1.5 text-[10px] uppercase text-muted-foreground">{m.authorType}</span>
                      {m.isInternal ? <span className="inline-flex items-center gap-0.5 text-amber-600"><Lock className="h-3 w-3" /> internal</span> : null}
                      <span className="ml-auto text-muted-foreground">{timeAgo(m.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-line text-sm text-foreground">{m.body}</p>
                  </div>
                )
              ))}
            </div>

            {t.status !== 'CLOSED' ? (
              <div className="rounded-xl border">
                <div className="flex items-center gap-1 border-b px-2 py-1.5">
                  <button type="button" onClick={() => setInternal(false)} className={`rounded-md px-3 py-1 text-sm font-medium ${!internal ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Public reply</button>
                  <button type="button" onClick={() => setInternal(true)} className={`rounded-md px-3 py-1 text-sm font-medium ${internal ? 'bg-amber-500 text-white' : 'text-muted-foreground'}`}>Internal note</button>
                  {!internal && (canned.data ?? []).length > 0 ? (
                    <select onChange={(e) => { const c = canned.data!.find((x) => x.id === e.target.value); if (c) setBody(c.body); e.target.value = ''; }} className="ml-auto h-8 rounded-md border bg-background px-2 text-xs text-muted-foreground">
                      <option value="">Canned reply…</option>
                      {canned.data!.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  ) : null}
                </div>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full resize-none bg-transparent px-3 py-2 text-sm outline-none" placeholder={internal ? 'Add an internal note (not visible to the customer)…' : 'Write a reply to the customer…'} />
                <div className="flex justify-end border-t px-3 py-2">
                  <Button size="sm" disabled={!body.trim() || reply.isPending} onClick={() => reply.mutate({ body, isInternal: internal })}>
                    {reply.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} {internal ? 'Add note' : 'Send reply'}
                  </Button>
                </div>
              </div>
            ) : <p className="rounded-xl border bg-muted/30 p-4 text-center text-sm text-muted-foreground">This ticket is closed. Reopen it to reply.</p>}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card title="Actions">
              <div className="flex flex-wrap gap-2">
                {t.status !== 'RESOLVED' && t.status !== 'CLOSED' ? <Button size="sm" onClick={() => status.mutate({ status: 'RESOLVED' })}>Resolve</Button> : null}
                {t.status === 'RESOLVED' ? <Button size="sm" variant="outline" onClick={() => status.mutate({ status: 'CLOSED' })}>Close</Button> : null}
                {['RESOLVED', 'CLOSED'].includes(t.status) ? <Button size="sm" variant="outline" onClick={() => status.mutate({ status: 'OPEN' })}>Reopen</Button> : null}
                {!['PENDING', 'RESOLVED', 'CLOSED'].includes(t.status) ? <Button size="sm" variant="outline" onClick={() => status.mutate({ status: 'PENDING' })}>Wait on customer</Button> : null}
              </div>
              <Row label="Status">
                <select value={t.status} onChange={(e) => status.mutate({ status: e.target.value })} className="h-8 rounded-md border bg-background px-2 text-sm">
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </Row>
              <Row label="Priority">
                <select value={t.priority} onChange={(e) => priorityMut.mutate(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Row>
              <Row label="Assignee">
                <select value={t.assignedTo ?? ''} onChange={(e) => assign.mutate({ assignedTo: e.target.value || null })} className="h-8 max-w-[160px] rounded-md border bg-background px-2 text-sm">
                  <option value="">Unassigned</option>
                  {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
                </select>
              </Row>
            </Card>

            <Card title="SLA">
              <SlaLine label="First response" met={!!t.firstRespondedAt} due={t.firstResponseDueAt} breached={t.firstResponseBreached} />
              <SlaLine label="Resolution" met={!!t.resolvedAt} due={t.resolutionDueAt} breached={t.resolutionBreached} />
              {t.slaPaused ? <p className="mt-1 text-xs text-amber-600">Clock paused (waiting on customer)</p> : null}
            </Card>

            <Card title="Requester">
              <p className="text-sm font-medium">{t.requesterName}</p>
              <p className="text-xs text-muted-foreground">{t.requesterEmail}</p>
              <p className="mt-1 text-xs text-muted-foreground">Channel: {t.channel}{t.category ? ` · ${t.category}` : ''}</p>
              {t.reopenedCount > 0 ? <p className="mt-1 text-xs text-muted-foreground">Reopened {t.reopenedCount}×</p> : null}
            </Card>

            {['RESOLVED', 'CLOSED'].includes(t.status) ? (
              <Card title="Satisfaction">
                {t.csatRating ? (
                  <div className="flex items-center gap-2"><span className="flex">{Array.from({ length: t.csatRating }).map((_, i) => <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />)}</span>{t.csatComment ? <span className="text-xs text-muted-foreground">“{t.csatComment}”</span> : null}</div>
                ) : (
                  <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => csat.mutate({ rating: n })}><Star className="h-5 w-5 text-zinc-300 hover:fill-amber-400 hover:text-amber-400" /></button>)}</div>
                )}
              </Card>
            ) : null}
          </div>
        </div>
      </PaneBody>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border p-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p><div className="space-y-2">{children}</div></div>;
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{label}</span>{children}</div>;
}
function SlaLine({ label, met, due, breached }: { label: string; met: boolean; due: string | null; breached: boolean }) {
  const d = dueLabel(due);
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {label}</span>
      <span className={met ? 'text-emerald-600' : breached ? 'font-medium text-rose-600' : d?.overdue ? 'text-rose-600' : 'text-foreground'}>
        {met ? 'met' : breached ? 'breached' : d?.text ?? '—'}
      </span>
    </div>
  );
}
