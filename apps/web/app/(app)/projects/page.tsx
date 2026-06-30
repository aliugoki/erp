'use client';
import { ModuleTitle } from '@/components/module-title';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, CheckCircle2, FolderKanban, Loader2, PauseCircle, Search } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Project } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { ProjBadge, fmtDate } from '@/components/projects/proj-ui';
import { ProjectDetail } from '@/components/projects/project-detail';
import { ProjectReports } from '@/components/projects/project-reports';
import { NewProjectDialog } from '@/components/projects/new-project-dialog';

type Section = 'projects' | 'reports';
const STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

export default function ProjectsPage() {
  const [section, setSection] = useState<Section>('projects');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const projects = useQuery({ queryKey: ['projects'], queryFn: () => apiGet<Project[]>('/projects') });

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); };
  const clear = () => setSel(null);
  const showDetail = !!sel || section === 'reports';
  const all = projects.data ?? [];
  const list = useMemo(() => all.filter((p) => (!q || `${p.projectNo} ${p.name} ${p.clientName ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!status || p.status === status)), [all, q, status]);
  const count = (s: string) => all.filter((p) => p.status === s).length;

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={FolderKanban} label="Projects" count={all.length || undefined} active={section === 'projects'} onClick={() => pick('projects')} />
      <RailItem icon={BarChart3} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="violet" />
    </div>
  );

  const listPane = (
    <Pane>
      {section === 'projects' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" className="h-9 w-full pl-9" /></div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
            <NewProjectDialog />
          </PaneHeader>
          <PaneBody>
            {projects.isLoading ? <Spinner /> : list.length === 0 ? <Hint>No projects.</Hint> : (
              <ul className="divide-y">{list.map((p) => (
                <li key={p.id}><ListRow active={sel === p.id} onClick={() => setSel(p.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="truncate text-xs text-muted-foreground">{p.projectNo}{p.clientName ? ` · ${p.clientName}` : ''} · {fmtDate(p.endDate)}</div></div>
                  <div className="flex flex-col items-end gap-1"><span className="text-xs font-semibold tabular-nums">{formatMoney(p.budget.amountMinor, p.budget.currency)}</span><ProjBadge status={p.status} /></div>
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Analytics</span></PaneHeader><PaneBody><div className="p-2"><ListRow active><BarChart3 className="h-4 w-4 text-violet-600" /><span className="flex-1 font-medium">Portfolio &amp; timesheets</span></ListRow></div></PaneBody></>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'projects' ? (sel ? <ProjectDetail id={sel} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={FolderKanban} title="Select a project" hint="Tasks, team, time approval, expenses, and costing." />)
        : <ProjectReports />}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <ModuleTitle>Projects</ModuleTitle>
        <p className="text-sm text-muted-foreground">Projects, tasks, timesheets, expenses, and costing.</p>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Projects" value={String(all.length)} icon={FolderKanban} />
        <Kpi label="Active" value={String(count('ACTIVE'))} icon={Activity} tone="emerald" />
        <Kpi label="On hold" value={String(count('ON_HOLD'))} icon={PauseCircle} tone={count('ON_HOLD') > 0 ? 'amber' : 'default'} />
        <Kpi label="Completed" value={String(count('COMPLETED'))} icon={CheckCircle2} tone="sky" />
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={listPane} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }
function Kpi({ label, value, icon: Icon, tone = 'default' }: { label: string; value: string; icon: typeof FolderKanban; tone?: 'default' | 'emerald' | 'amber' | 'sky' }) {
  const tones: Record<string, string> = { default: 'text-primary', emerald: 'text-emerald-600', amber: 'text-amber-600', sky: 'text-sky-600' };
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tones[tone]}`} /></div><p className="mt-2 text-xl font-bold tabular-nums">{value}</p></div>;
}
