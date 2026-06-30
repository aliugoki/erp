'use client';
import { ModuleTitle } from '@/components/module-title';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Building2, CalendarCheck, Gauge, Loader2, Search, Sparkles, Target, Trophy } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Activity, CrmAccount, Deal, ForecastReport, Lead, WinLossReport } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { ACTIVITY_META, AccountStatusBadge, LEAD_STATUSES, LeadStatusBadge, RatingBadge, STAGES, StageBadge, dueLabel, fmtDate } from '@/components/crm/crm-ui';
import { AccountDetail } from '@/components/crm/account-detail';
import { LeadDetail } from '@/components/crm/lead-detail';
import { DealDetail } from '@/components/crm/deal-detail';
import { ActivityDetail } from '@/components/crm/activity-detail';
import { CrmReports } from '@/components/crm/crm-reports';
import { NewAccountDialog } from '@/components/crm/new-account-dialog';
import { NewLeadDialog } from '@/components/crm/new-lead-dialog';
import { NewDealDialog } from '@/components/crm/new-deal-dialog';
import { NewActivityDialog } from '@/components/crm/new-activity-dialog';

type Section = 'accounts' | 'leads' | 'pipeline' | 'activities' | 'reports';

export default function CrmPage() {
  const [section, setSection] = useState<Section>('accounts');
  const [accSel, setAccSel] = useState<string | null>(null);
  const [leadSel, setLeadSel] = useState<string | null>(null);
  const [dealSel, setDealSel] = useState<string | null>(null);
  const [actSel, setActSel] = useState<Activity | null>(null);
  const [q, setQ] = useState('');
  const [leadStatus, setLeadStatus] = useState('');
  const [actScope, setActScope] = useState<'open' | 'all'>('open');

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<CrmAccount[]>('/crm/clients') });
  const leads = useQuery({ queryKey: ['leads'], queryFn: () => apiGet<Lead[]>('/crm/leads') });
  const deals = useQuery({ queryKey: ['deals'], queryFn: () => apiGet<Deal[]>('/crm/deals') });
  const openTasks = useQuery({ queryKey: ['open-tasks'], queryFn: () => apiGet<Activity[]>('/crm/activities/open') });
  const allActs = useQuery({ queryKey: ['activities'], queryFn: () => apiGet<Activity[]>('/crm/activities'), enabled: section === 'activities' && actScope === 'all' });
  const forecast = useQuery({ queryKey: ['forecast'], queryFn: () => apiGet<ForecastReport>('/crm/reports/forecast') });
  const winLoss = useQuery({ queryKey: ['win-loss'], queryFn: () => apiGet<WinLossReport>('/crm/reports/win-loss') });

  const clearDetail = () => { setAccSel(null); setLeadSel(null); setDealSel(null); setActSel(null); };
  const pick = (s: Section) => { setSection(s); clearDetail(); setQ(''); };

  const accList = useMemo(() => (accounts.data ?? []).filter((a) => !q || a.companyName.toLowerCase().includes(q.toLowerCase())), [accounts.data, q]);
  const leadList = useMemo(() => (leads.data ?? []).filter((l) => (!q || l.name.toLowerCase().includes(q.toLowerCase()) || (l.company ?? '').toLowerCase().includes(q.toLowerCase())) && (!leadStatus || l.status === leadStatus)), [leads.data, q, leadStatus]);
  const dealList = deals.data ?? [];
  const actList = (actScope === 'open' ? openTasks.data : allActs.data) ?? [];

  const dealsByStage = useMemo(() => STAGES.map((stage) => ({ stage, items: dealList.filter((d) => d.stage === stage) })).filter((g) => g.items.length > 0), [dealList]);

  const showDetail = (section === 'accounts' && !!accSel) || (section === 'leads' && !!leadSel) || (section === 'pipeline' && !!dealSel) || (section === 'activities' && !!actSel) || section === 'reports';

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
      <RailItem icon={Building2} label="Accounts" count={accounts.data?.length} active={section === 'accounts'} onClick={() => pick('accounts')} />
      <RailItem icon={Sparkles} label="Leads" count={leads.data?.length} active={section === 'leads'} onClick={() => pick('leads')} tone="amber" />
      <RailItem icon={Target} label="Pipeline" count={dealList.length || undefined} active={section === 'pipeline'} onClick={() => pick('pipeline')} tone="violet" />
      <RailItem icon={CalendarCheck} label="Activities" count={openTasks.data?.length} active={section === 'activities'} onClick={() => pick('activities')} tone="emerald" />
      <RailItem icon={BarChart3} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="sky" />
    </div>
  );

  const list = (
    <Pane>
      {section === 'accounts' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts…" className="h-9 w-full pl-9" /></div>
            <NewAccountDialog />
          </PaneHeader>
          <PaneBody>
            {accounts.isLoading ? <Spinner /> : accList.length === 0 ? <Hint>No accounts.</Hint> : (
              <ul className="divide-y">{accList.map((a) => (
                <li key={a.id}><ListRow active={accSel === a.id} onClick={() => setAccSel(a.id)}>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{a.companyName}</span><AccountStatusBadge status={a.status} /></div><div className="truncate text-xs text-muted-foreground">{[a.industry, a.city].filter(Boolean).join(' · ') || a.accountNo || '—'}</div></div>
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'leads' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads…" className="h-9 w-full pl-9" /></div>
            <select value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">All</option>{[...LEAD_STATUSES, 'CONVERTED'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <NewLeadDialog />
          </PaneHeader>
          <PaneBody>
            {leads.isLoading ? <Spinner /> : leadList.length === 0 ? <Hint>No leads.</Hint> : (
              <ul className="divide-y">{leadList.map((l) => (
                <li key={l.id}><ListRow active={leadSel === l.id} onClick={() => setLeadSel(l.id)}>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{l.name}</span><RatingBadge rating={l.rating} /></div><div className="truncate text-xs text-muted-foreground">{l.company ?? l.email ?? '—'}</div></div>
                  <LeadStatusBadge status={l.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'pipeline' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Pipeline</span><NewDealDialog /></PaneHeader>
          <PaneBody>
            {deals.isLoading ? <Spinner /> : dealsByStage.length === 0 ? <Hint>No deals.</Hint> : (
              <div>{dealsByStage.map((g) => (
                <div key={g.stage}>
                  <div className="sticky top-0 flex items-center justify-between bg-muted/60 px-4 py-1.5 backdrop-blur"><StageBadge stage={g.stage} /><span className="text-xs tabular-nums text-muted-foreground">{g.items.length} · {formatMoney(g.items.reduce((s, d) => s + d.weighted.amountMinor, 0), g.items[0]?.weighted.currency ?? 'PKR')}</span></div>
                  <ul className="divide-y">{g.items.map((d) => (
                    <li key={d.id}><ListRow active={dealSel === d.id} onClick={() => setDealSel(d.id)}>
                      <div className="min-w-0 flex-1"><div className="truncate font-medium">{d.title}</div><div className="truncate text-xs text-muted-foreground">{d.probability}% · {fmtDate(d.expectedCloseDate)}</div></div>
                      <span className="text-xs font-semibold tabular-nums">{formatMoney(d.value.amountMinor, d.value.currency)}</span>
                    </ListRow></li>
                  ))}</ul>
                </div>
              ))}</div>
            )}
          </PaneBody>
        </>
      ) : section === 'activities' ? (
        <>
          <PaneHeader>
            <div className="flex flex-1 rounded-md border p-0.5 text-xs">
              <button type="button" onClick={() => setActScope('open')} className={`flex-1 rounded px-2 py-1 ${actScope === 'open' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}>Open</button>
              <button type="button" onClick={() => setActScope('all')} className={`flex-1 rounded px-2 py-1 ${actScope === 'all' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}>All</button>
            </div>
            <NewActivityDialog />
          </PaneHeader>
          <PaneBody>
            {(actScope === 'open' ? openTasks.isLoading : allActs.isLoading) ? <Spinner /> : actList.length === 0 ? <Hint>No activities.</Hint> : (
              <ul className="divide-y">{actList.map((a) => {
                const meta = ACTIVITY_META[a.type] ?? ACTIVITY_META.NOTE!; const Icon = meta.icon; const due = dueLabel(a.dueAt);
                return (<li key={a.id}><ListRow active={actSel?.id === a.id} onClick={() => setActSel(a)}>
                  <Icon className={`h-4 w-4 shrink-0 ${a.completed ? 'text-muted-foreground' : meta.tone}`} />
                  <div className="min-w-0 flex-1"><div className={`truncate font-medium ${a.completed ? 'text-muted-foreground line-through' : ''}`}>{a.subject}</div><div className="truncate text-xs text-muted-foreground">{a.type}{a.dueAt ? <span className={due?.overdue && !a.completed ? ' text-rose-600' : ''}> · {due?.text}</span> : ''}</div></div>
                </ListRow></li>);
              })}</ul>
            )}
          </PaneBody>
        </>
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Analytics</span></PaneHeader><PaneBody><div className="p-2"><ListRow active><BarChart3 className="h-4 w-4 text-sky-600" /><span className="flex-1 font-medium">Sales reports</span></ListRow></div></PaneBody></>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'accounts' ? (accSel ? <AccountDetail id={accSel} onBack={clearDetail} onDeleted={clearDetail} /> : <EmptyDetail icon={Building2} title="Select an account" hint="View and edit company details, contacts, and activity." />)
        : section === 'leads' ? (leadSel ? <LeadDetail id={leadSel} onBack={clearDetail} onDeleted={clearDetail} /> : <EmptyDetail icon={Sparkles} title="Select a lead" hint="Qualify, edit, and convert leads into accounts + opportunities." />)
        : section === 'pipeline' ? (dealSel ? <DealDetail id={dealSel} onBack={clearDetail} onDeleted={clearDetail} /> : <EmptyDetail icon={Target} title="Select a deal" hint="Move it through stages, edit terms, and log activity." />)
        : section === 'activities' ? (actSel ? <ActivityDetail activity={actSel} onBack={clearDetail} onChanged={() => { void openTasks.refetch(); void allActs.refetch(); }} onDeleted={clearDetail} /> : <EmptyDetail icon={CalendarCheck} title="Select an activity" hint="Calls, meetings, emails, and tasks across your pipeline." />)
        : <CrmReports />}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <ModuleTitle>CRM</ModuleTitle>
        <p className="text-sm text-muted-foreground">Accounts, leads, pipeline, activities, and sales analytics.</p>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Weighted forecast" value={forecast.data ? formatMoney(forecast.data.weightedTotal.amountMinor, forecast.data.weightedTotal.currency) : '—'} icon={Gauge} tone="violet" />
        <Kpi label="Open pipeline" value={forecast.data ? formatMoney(forecast.data.openTotal.amountMinor, forecast.data.openTotal.currency) : '—'} icon={Target} />
        <Kpi label="Active leads" value={leads.data ? String(leads.data.filter((l) => l.status !== 'CONVERTED' && l.status !== 'UNQUALIFIED').length) : '—'} icon={Sparkles} tone="amber" />
        <Kpi label="Win rate" value={winLoss.data ? `${winLoss.data.winRate}%` : '—'} sub={winLoss.data ? `${winLoss.data.won.count} won` : ''} icon={Trophy} tone="emerald" />
      </div>

      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }
function Kpi({ label, value, sub = '', icon: Icon, tone = 'default' }: { label: string; value: string; sub?: string; icon: typeof Gauge; tone?: 'default' | 'violet' | 'amber' | 'emerald' }) {
  const tones: Record<string, string> = { default: 'text-primary', violet: 'text-violet-600', amber: 'text-amber-600', emerald: 'text-emerald-600' };
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tones[tone]}`} /></div><p className="mt-2 text-xl font-bold tabular-nums">{value}</p>{sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}</div>;
}
