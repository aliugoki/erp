'use client';
import { ModuleTitle } from '@/components/module-title';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Briefcase, Building2, CalendarCheck, FileText, Loader2, Plane, Receipt, Search, Target, Users, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Branch, Department, Employee, HeadcountReport } from '@/lib/types';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { HrStatusBadge } from '@/components/hr/hr-ui';
import { EmployeeDetail } from '@/components/hr/employee-detail';
import { AttendancePanel } from '@/components/hr/attendance-panel';
import { LeavePanel } from '@/components/hr/leave-panel';
import { PayrollPanel } from '@/components/hr/payroll-panel';
import { PerformancePanel } from '@/components/hr/performance-panel';
import { PoliciesPanel } from '@/components/hr/policies-panel';
import { OrgPanel } from '@/components/hr/org-panel';
import { ExpensesPanel } from '@/components/hr/expenses-panel';
import { HrReports } from '@/components/hr/hr-reports';
import { NewEmployeeDialog } from '@/components/hr/new-employee-dialog';
import { Input } from '@/components/ui/input';

type Section = 'employees' | 'attendance' | 'leave' | 'payroll' | 'expenses' | 'performance' | 'policies' | 'org' | 'reports';
const STATUSES = ['ACTIVE', 'ON_LEAVE', 'TERMINATED'];

export default function HrPage() {
  const [section, setSection] = useState<Section>('employees');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [branch, setBranch] = useState('');

  const employees = useQuery({ queryKey: ['employees'], queryFn: () => apiGet<Employee[]>('/hr/employees?pageSize=200'), enabled: section === 'employees' });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => apiGet<Department[]>('/hr/departments') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => apiGet<Branch[]>('/branches') });
  const headcount = useQuery({ queryKey: ['headcount'], queryFn: () => apiGet<HeadcountReport>('/hr/reports/headcount') });

  const deptName = useMemo(() => new Map((departments.data ?? []).map((d) => [d.id, d.name])), [departments.data]);
  const branchName = useMemo(() => new Map((branches.data ?? []).map((b) => [b.id, b.name])), [branches.data]);
  const empList = useMemo(() => (employees.data ?? []).filter((e) => {
    const name = `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase();
    return (!q || name.includes(q.toLowerCase())) && (!status || e.status === status) && (!branch || e.branchId === branch);
  }), [employees.data, q, status, branch]);

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); setBranch(''); };
  const clear = () => setSel(null);
  const fullPane = section !== 'employees';
  const showDetail = !!sel || fullPane;
  const hc = headcount.data;
  const onLeave = hc?.byStatus.find((s) => s.status === 'ON_LEAVE')?.count ?? 0;

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={Users} label="Employees" count={hc?.total} active={section === 'employees'} onClick={() => pick('employees')} />
      <RailItem icon={CalendarCheck} label="Attendance" active={section === 'attendance'} onClick={() => pick('attendance')} tone="sky" />
      <RailItem icon={Plane} label="Leave" active={section === 'leave'} onClick={() => pick('leave')} tone="amber" />
      <RailItem icon={Wallet} label="Payroll" active={section === 'payroll'} onClick={() => pick('payroll')} tone="emerald" />
      <RailItem icon={Receipt} label="Expenses" active={section === 'expenses'} onClick={() => pick('expenses')} tone="amber" />
      <RailItem icon={Target} label="Performance" active={section === 'performance'} onClick={() => pick('performance')} tone="violet" />
      <RailItem icon={FileText} label="Policies" active={section === 'policies'} onClick={() => pick('policies')} />
      <RailItem icon={Building2} label="Organization" active={section === 'org'} onClick={() => pick('org')} />
      <div className="my-1 border-t" />
      <RailItem icon={BarChart3} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="violet" />
    </div>
  );

  const list = (
    <Pane>
      {section === 'employees' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff…" className="h-9 w-full pl-9" /></div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
            {(branches.data ?? []).length > 0 ? (
              <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" title="Filter by branch"><option value="">All branches</option>{(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            ) : null}
            <NewEmployeeDialog />
          </PaneHeader>
          <PaneBody>
            {employees.isLoading ? <Spinner /> : empList.length === 0 ? <Hint>No employees.</Hint> : (
              <ul className="divide-y">{empList.map((e) => (
                <li key={e.id}><ListRow active={sel === e.id} onClick={() => setSel(e.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{e.firstName} {e.lastName}</div><div className="truncate text-xs text-muted-foreground">{e.employeeCode}{e.departmentId ? ` · ${deptName.get(e.departmentId) ?? ''}` : ''}{e.branchId ? ` · ${branchName.get(e.branchId) ?? ''}` : ''}</div></div>
                  <HrStatusBadge status={e.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium capitalize">{section}</span></PaneHeader><PaneBody><div className="p-2"><ListRow active><Briefcase className="h-4 w-4 text-primary" /><span className="flex-1 font-medium capitalize">{section}</span></ListRow></div></PaneBody></>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'employees' ? (sel ? <EmployeeDetail id={sel} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={Users} title="Select an employee" hint="Full profile, lifecycle, leave balances, and documents." />)
        : section === 'attendance' ? <AttendancePanel />
        : section === 'leave' ? <LeavePanel />
        : section === 'payroll' ? <PayrollPanel />
        : section === 'expenses' ? <ExpensesPanel />
        : section === 'performance' ? <PerformancePanel />
        : section === 'policies' ? <PoliciesPanel />
        : section === 'org' ? <OrgPanel />
        : <HrReports />}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <ModuleTitle>Human Resources</ModuleTitle>
        <p className="text-sm text-muted-foreground">People, attendance, leave, payroll, performance, and HR analytics.</p>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Headcount" value={hc ? String(hc.total) : '—'} icon={Users} />
        <Kpi label="On leave" value={String(onLeave)} icon={Plane} tone={onLeave > 0 ? 'amber' : 'default'} />
        <Kpi label="Departments" value={departments.data ? String(departments.data.length) : '—'} icon={Building2} tone="violet" />
        <Kpi label="Active" value={hc ? String(hc.byStatus.find((s) => s.status === 'ACTIVE')?.count ?? 0) : '—'} icon={Briefcase} tone="emerald" />
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }
function Kpi({ label, value, icon: Icon, tone = 'default' }: { label: string; value: string; icon: typeof Users; tone?: 'default' | 'amber' | 'emerald' | 'violet' }) {
  const tones: Record<string, string> = { default: 'text-primary', amber: 'text-amber-600', emerald: 'text-emerald-600', violet: 'text-violet-600' };
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tones[tone]}`} /></div><p className="mt-2 text-xl font-bold tabular-nums">{value}</p></div>;
}
