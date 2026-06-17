'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FolderKanban, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Employee, Project, ProjectExpense, ProjectTimeEntry } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TABS = ['tasks', 'time', 'members', 'expenses'] as const;
type Tab = (typeof TABS)[number];
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PLANNED: 'outline', ACTIVE: 'default', ON_HOLD: 'secondary', COMPLETED: 'secondary', CANCELLED: 'destructive',
  TODO: 'outline', IN_PROGRESS: 'default', BLOCKED: 'destructive', DONE: 'secondary',
  DRAFT: 'outline', SUBMITTED: 'secondary', APPROVED: 'default', REJECTED: 'destructive',
};
const hrs = (min: number) => `${Math.round((min / 60) * 10) / 10}h`;

export function ProjectDetailDialog({ projectId, open, onOpenChange }: { projectId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('tasks');
  const proj = useQuery({ queryKey: ['project', projectId], queryFn: () => apiGet<Project>(`/projects/${projectId}`), enabled: !!projectId && open });
  const time = useQuery({ queryKey: ['project-time', projectId], queryFn: () => apiGet<ProjectTimeEntry[]>(`/projects/${projectId}/time`), enabled: !!projectId && open && tab === 'time' });
  const expenses = useQuery({ queryKey: ['project-expenses', projectId], queryFn: () => apiGet<ProjectExpense[]>(`/projects/${projectId}/expenses`), enabled: !!projectId && open && tab === 'expenses' });
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => apiGet<Employee[]>('/hr/employees'), enabled: open, retry: false });

  const p = proj.data;
  const cur = p?.budget.currency ?? 'PKR';
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['project', projectId] });
    void qc.invalidateQueries({ queryKey: ['project-time', projectId] });
    void qc.invalidateQueries({ queryKey: ['project-expenses', projectId] });
    void qc.invalidateQueries({ queryKey: ['project-portfolio'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Action failed');
  const ok = (m: string) => () => { toast.success(m); refresh(); };

  // form state
  const [taskName, setTaskName] = useState('');
  const [memberEmp, setMemberEmp] = useState(''); const [costRate, setCostRate] = useState(''); const [billRate, setBillRate] = useState('');
  const [timeEmp, setTimeEmp] = useState(''); const [timeHours, setTimeHours] = useState('');
  const [expCat, setExpCat] = useState(''); const [expAmt, setExpAmt] = useState('');

  const setStatus = useMutation({ mutationFn: (status: string) => apiPatch(`/projects/${projectId}/status`, { status }), onSuccess: ok('Status updated'), onError: fail });
  const addTask = useMutation({ mutationFn: () => apiPost(`/projects/${projectId}/tasks`, { name: taskName }), onSuccess: () => { setTaskName(''); ok('Task added')(); }, onError: fail });
  const taskStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/projects/${projectId}/tasks/${id}`, { status }), onSuccess: ok('Task updated'), onError: fail });
  const addMember = useMutation({ mutationFn: () => apiPost(`/projects/${projectId}/members`, { employeeId: memberEmp, costRateMinor: Math.round((Number(costRate) || 0) * 100), billRateMinor: Math.round((Number(billRate) || 0) * 100) }), onSuccess: () => { setMemberEmp(''); setCostRate(''); setBillRate(''); ok('Member added')(); }, onError: fail });
  const logTime = useMutation({ mutationFn: () => apiPost(`/projects/${projectId}/time`, { employeeId: timeEmp, minutes: Math.round((Number(timeHours) || 0) * 60) }), onSuccess: () => { setTimeEmp(''); setTimeHours(''); ok('Time logged')(); }, onError: fail });
  const approveTime = useMutation({ mutationFn: (id: string) => apiPatch(`/projects/${projectId}/time/${id}/status`, { status: 'APPROVED' }), onSuccess: ok('Time approved'), onError: fail });
  const addExpense = useMutation({ mutationFn: () => apiPost(`/projects/${projectId}/expenses`, { category: expCat || undefined, amountMinor: Math.round((Number(expAmt) || 0) * 100) }), onSuccess: () => { setExpCat(''); setExpAmt(''); ok('Expense added')(); }, onError: fail });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5" /> {p?.projectNo ?? 'Project'}
            {p ? <Badge variant={STATUS_VARIANT[p.status] ?? 'outline'}>{p.status}</Badge> : null}
          </DialogTitle>
        </DialogHeader>

        {!p ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-lg font-medium">{p.name}</p>
                <p className="text-sm text-muted-foreground">{[p.clientName, p.managerName ? `PM: ${p.managerName}` : null].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              <Select value={p.status} onValueChange={(v) => setStatus.mutate(v)}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Costing */}
            {p.costing ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Budget" value={formatMoney(p.costing.budget.amountMinor, cur)} />
                <Stat label="Cost" value={formatMoney(p.costing.totalCost.amountMinor, cur)} />
                <Stat label="Billable" value={formatMoney(p.costing.billable.amountMinor, cur)} />
                <Stat label="Remaining" value={formatMoney(p.costing.remaining.amountMinor, cur)} danger={p.costing.remaining.amountMinor < 0} />
                <Stat label="Hours" value={`${p.costing.hours}h`} />
              </div>
            ) : null}

            <div className="flex gap-1 border-b">
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium capitalize transition ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{t}</button>
              ))}
            </div>

            {/* Tasks */}
            {tab === 'tasks' ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input placeholder="New task name" value={taskName} onChange={(e) => setTaskName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && taskName) addTask.mutate(); }} />
                  <Button size="sm" disabled={!taskName || addTask.isPending} onClick={() => addTask.mutate()}><Plus className="h-4 w-4" /></Button>
                </div>
                {(p.tasks ?? []).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm">
                    <span className="truncate">{t.name}{t.assigneeName ? <span className="text-muted-foreground"> · {t.assigneeName}</span> : null}</span>
                    <Select value={t.status} onValueChange={(v) => taskStatus.mutate({ id: t.id, status: v })}>
                      <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ))}
                {(p.tasks ?? []).length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No tasks yet.</p> : null}
              </div>
            ) : null}

            {/* Time */}
            {tab === 'time' ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Select value={timeEmp} onValueChange={setTimeEmp}>
                    <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Employee" /></SelectTrigger>
                    <SelectContent>{(employees.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input className="w-24" type="number" min="0" step="0.25" placeholder="Hours" value={timeHours} onChange={(e) => setTimeHours(e.target.value)} />
                  <Button size="sm" disabled={!timeEmp || !timeHours || logTime.isPending} onClick={() => logTime.mutate()}>Log time</Button>
                </div>
                {(time.data ?? []).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm">
                    <span className="truncate">{t.entryDate} · {t.employeeName} · {hrs(t.minutes)}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[t.status] ?? 'outline'} className="text-[10px]">{t.status}</Badge>
                      {t.status === 'APPROVED' ? <span className="tabular-nums text-xs text-muted-foreground">{formatMoney(t.cost.amountMinor, cur)}</span> :
                        <Button size="sm" variant="outline" className="h-6" disabled={approveTime.isPending} onClick={() => approveTime.mutate(t.id)}><Check className="mr-1 h-3 w-3" />Approve</Button>}
                    </span>
                  </div>
                ))}
                {(time.data ?? []).length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No time logged.</p> : null}
              </div>
            ) : null}

            {/* Members */}
            {tab === 'members' ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Select value={memberEmp} onValueChange={setMemberEmp}>
                    <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Employee" /></SelectTrigger>
                    <SelectContent>{(employees.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input className="w-28" type="number" min="0" placeholder="Cost/hr" value={costRate} onChange={(e) => setCostRate(e.target.value)} />
                  <Input className="w-28" type="number" min="0" placeholder="Bill/hr" value={billRate} onChange={(e) => setBillRate(e.target.value)} />
                  <Button size="sm" disabled={!memberEmp || addMember.isPending} onClick={() => addMember.mutate()}>Add</Button>
                </div>
                {(p.members ?? []).map((mb) => (
                  <div key={mb.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm">
                    <span>{mb.employeeName}{mb.role ? ` · ${mb.role}` : ''}</span>
                    <span className="text-xs text-muted-foreground">cost {formatMoney(mb.costRate.amountMinor, cur)}/h · bill {formatMoney(mb.billRate.amountMinor, cur)}/h</span>
                  </div>
                ))}
                {(p.members ?? []).length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No members yet.</p> : null}
              </div>
            ) : null}

            {/* Expenses */}
            {tab === 'expenses' ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Input className="flex-1" placeholder="Category" value={expCat} onChange={(e) => setExpCat(e.target.value)} />
                  <Input className="w-28" type="number" min="0" step="0.01" placeholder="Amount" value={expAmt} onChange={(e) => setExpAmt(e.target.value)} />
                  <Button size="sm" disabled={!expAmt || addExpense.isPending} onClick={() => addExpense.mutate()}>Add</Button>
                </div>
                {(expenses.data ?? []).map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm">
                    <span>{x.expenseDate} · {x.category ?? 'Expense'}</span>
                    <span className="tabular-nums">{formatMoney(x.amount.amountMinor, cur)}</span>
                  </div>
                ))}
                {(expenses.data ?? []).length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No expenses.</p> : null}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`truncate text-sm font-medium tabular-nums ${danger ? 'text-destructive' : ''}`}>{value}</p>
    </div>
  );
}
