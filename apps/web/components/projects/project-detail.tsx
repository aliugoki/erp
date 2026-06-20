'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Project, ProjectExpense, ProjectTimeEntry } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { PriorityBadge, ProjBadge, fmtDate, hrs } from './proj-ui';

type Employee = { id: string; firstName: string; lastName: string };

const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const BILLING_TYPES = ['FIXED', 'TIME_MATERIALS', 'NON_BILLABLE'];
const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function ProjectDetail({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ['project', id], queryFn: () => apiGet<Project>(`/projects/${id}`) });
  const time = useQuery({ queryKey: ['project-time', id], queryFn: () => apiGet<ProjectTimeEntry[]>(`/projects/${id}/time`) });
  const expenses = useQuery({ queryKey: ['project-expenses', id], queryFn: () => apiGet<ProjectExpense[]>(`/projects/${id}/expenses`) });
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => apiGet<Employee[]>('/hr/employees?pageSize=200') });
  const empName = (e: Employee) => `${e.firstName} ${e.lastName}`;

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const invalidateProject = () => { void qc.invalidateQueries({ queryKey: ['project', id] }); void qc.invalidateQueries({ queryKey: ['projects'] }); };

  // Edit project form
  const [f, setF] = useState({ name: '', code: '', billingType: 'FIXED', budget: '', startDate: '', endDate: '', description: '' });
  useEffect(() => {
    const p = project.data;
    if (p) setF({ name: p.name, code: p.code ?? '', billingType: p.billingType, budget: String(p.budget.amountMinor / 100), startDate: p.startDate ? p.startDate.slice(0, 10) : '', endDate: p.endDate ? p.endDate.slice(0, 10) : '', description: p.description ?? '' });
  }, [project.data]);

  // Add-task form
  const [task, setTask] = useState({ name: '', assigneeEmployeeId: '', priority: 'NORMAL', dueDate: '' });
  // Add-member form
  const [member, setMember] = useState({ employeeId: '', role: '', costRate: '', billRate: '' });
  // Log-time form
  const [logForm, setLogForm] = useState({ employeeId: '', taskId: '', entryDate: '', minutes: '', billable: true, description: '' });
  // Add-expense form
  const [expense, setExpense] = useState({ expenseDate: '', category: '', amount: '', billable: true, description: '' });

  const setStatus = useMutation({ mutationFn: (status: string) => apiPatch(`/projects/${id}/status`, { status }), onSuccess: () => { toast.success('Status updated'); invalidateProject(); }, onError: onErr });
  const remove = useMutation({ mutationFn: () => apiDelete(`/projects/${id}`), onSuccess: () => { toast.success('Project deleted'); invalidateProject(); onDeleted?.(); }, onError: onErr });
  const save = useMutation({
    mutationFn: () => apiPatch(`/projects/${id}`, { name: f.name, code: f.code || undefined, billingType: f.billingType, budgetMinor: Math.round((Number(f.budget) || 0) * 100), startDate: f.startDate || undefined, endDate: f.endDate || undefined, description: f.description || undefined }),
    onSuccess: () => { toast.success('Project saved'); invalidateProject(); }, onError: onErr,
  });

  const addTask = useMutation({
    mutationFn: () => apiPost(`/projects/${id}/tasks`, { name: task.name, assigneeEmployeeId: task.assigneeEmployeeId || undefined, priority: task.priority, dueDate: task.dueDate || undefined }),
    onSuccess: () => { setTask({ name: '', assigneeEmployeeId: '', priority: 'NORMAL', dueDate: '' }); toast.success('Task added'); invalidateProject(); }, onError: onErr,
  });
  const patchTask = useMutation({ mutationFn: ({ taskId, body }: { taskId: string; body: Record<string, unknown> }) => apiPatch(`/projects/${id}/tasks/${taskId}`, body), onSuccess: () => { toast.success('Task updated'); invalidateProject(); }, onError: onErr });
  const deleteTask = useMutation({ mutationFn: (taskId: string) => apiDelete(`/projects/${id}/tasks/${taskId}`), onSuccess: () => { toast.success('Task deleted'); invalidateProject(); }, onError: onErr });

  const addMember = useMutation({
    mutationFn: () => apiPost(`/projects/${id}/members`, { employeeId: member.employeeId, role: member.role || undefined, costRateMinor: Math.round((Number(member.costRate) || 0) * 100), billRateMinor: Math.round((Number(member.billRate) || 0) * 100) }),
    onSuccess: () => { setMember({ employeeId: '', role: '', costRate: '', billRate: '' }); toast.success('Member added'); invalidateProject(); }, onError: onErr,
  });
  const deleteMember = useMutation({ mutationFn: (memberId: string) => apiDelete(`/projects/${id}/members/${memberId}`), onSuccess: () => { toast.success('Member removed'); invalidateProject(); }, onError: onErr });

  const invalidateTime = () => { void qc.invalidateQueries({ queryKey: ['project-time', id] }); void qc.invalidateQueries({ queryKey: ['project', id] }); };
  const logTime = useMutation({
    mutationFn: () => apiPost(`/projects/${id}/time`, { employeeId: logForm.employeeId, taskId: logForm.taskId || undefined, entryDate: logForm.entryDate || undefined, minutes: Number(logForm.minutes), billable: logForm.billable, description: logForm.description || undefined }),
    onSuccess: () => { setLogForm({ employeeId: '', taskId: '', entryDate: '', minutes: '', billable: true, description: '' }); toast.success('Time logged'); invalidateTime(); }, onError: onErr,
  });
  const timeStatus = useMutation({ mutationFn: ({ entryId, status }: { entryId: string; status: string }) => apiPatch(`/projects/${id}/time/${entryId}/status`, { status }), onSuccess: () => { toast.success('Time updated'); invalidateTime(); }, onError: onErr });
  const deleteTime = useMutation({ mutationFn: (entryId: string) => apiDelete(`/projects/${id}/time/${entryId}`), onSuccess: () => { toast.success('Time deleted'); invalidateTime(); }, onError: onErr });

  const invalidateExpenses = () => { void qc.invalidateQueries({ queryKey: ['project-expenses', id] }); void qc.invalidateQueries({ queryKey: ['project', id] }); };
  const addExpense = useMutation({
    mutationFn: () => apiPost(`/projects/${id}/expenses`, { expenseDate: expense.expenseDate || undefined, category: expense.category || undefined, amountMinor: Math.round((Number(expense.amount) || 0) * 100), billable: expense.billable, description: expense.description || undefined }),
    onSuccess: () => { setExpense({ expenseDate: '', category: '', amount: '', billable: true, description: '' }); toast.success('Expense added'); invalidateExpenses(); }, onError: onErr,
  });
  const deleteExpense = useMutation({ mutationFn: (expenseId: string) => apiDelete(`/projects/${id}/expenses/${expenseId}`), onSuccess: () => { toast.success('Expense deleted'); invalidateExpenses(); }, onError: onErr });

  if (project.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (project.isError || !project.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Project not found.</div>;
  const p = project.data;
  const c = p.costing;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{p.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{p.projectNo}</span>
          <ProjBadge status={p.status} />
        </div>
        <select value={p.status} onChange={(e) => setStatus.mutate(e.target.value)} disabled={setStatus.isPending} className="h-8 rounded-md border bg-background px-2 text-sm">
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this project?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        {/* Costing */}
        {c ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Tile label="Budget" value={formatMoney(c.budget.amountMinor, c.budget.currency)} />
            <Tile label="Labour" value={formatMoney(c.laborCost.amountMinor, c.laborCost.currency)} />
            <Tile label="Expenses" value={formatMoney(c.expenseCost.amountMinor, c.expenseCost.currency)} />
            <Tile label="Total" value={formatMoney(c.totalCost.amountMinor, c.totalCost.currency)} />
            <Tile label="Billable" value={formatMoney(c.billable.amountMinor, c.billable.currency)} />
            <Tile label="Remaining" value={formatMoney(c.remaining.amountMinor, c.remaining.currency)} tone={c.remaining.amountMinor < 0 ? 'rose' : 'default'} />
            <Tile label="Hours" value={`${c.hours}h`} />
          </div>
        ) : null}

        {/* Edit project */}
        <section className="grid max-w-2xl grid-cols-2 gap-4 border-t pt-5">
          <h3 className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit project</h3>
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
          <Field label="Code"><Input value={f.code} onChange={(e) => setF((s) => ({ ...s, code: e.target.value }))} /></Field>
          <Field label="Billing type">
            <select value={f.billingType} onChange={(e) => setF((s) => ({ ...s, billingType: e.target.value }))} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              {BILLING_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Budget"><Input value={f.budget} onChange={(e) => setF((s) => ({ ...s, budget: e.target.value }))} type="number" min={0} step="0.01" /></Field>
          <Field label="Start date"><Input value={f.startDate} onChange={(e) => setF((s) => ({ ...s, startDate: e.target.value }))} type="date" /></Field>
          <Field label="End date"><Input value={f.endDate} onChange={(e) => setF((s) => ({ ...s, endDate: e.target.value }))} type="date" /></Field>
          <Field label="Description" className="col-span-2"><textarea value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} rows={3} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" /></Field>
          <div className="col-span-2"><Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </section>

        {/* Tasks */}
        <section className="border-t pt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</h3>
          <div className="space-y-1.5">
            {(p.tasks ?? []).map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{t.name}{t.assigneeName ? <span className="text-muted-foreground"> · {t.assigneeName}</span> : null}{t.dueDate ? <span className="text-muted-foreground"> · due {fmtDate(t.dueDate)}</span> : null}</span>
                <ProjBadge status={t.status} />
                <PriorityBadge priority={t.priority} />
                <select value={t.status} onChange={(e) => patchTask.mutate({ taskId: t.id, body: { status: e.target.value } })} className="h-7 rounded-md border bg-background px-1.5 text-xs">
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={t.priority} onChange={(e) => patchTask.mutate({ taskId: t.id, body: { priority: e.target.value } })} className="h-7 rounded-md border bg-background px-1.5 text-xs">
                  {PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteTask.mutate(t.id)} title="Delete"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>
              </div>
            ))}
            {(p.tasks ?? []).length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No tasks yet.</p> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="w-40" placeholder="Task name" value={task.name} onChange={(e) => setTask((s) => ({ ...s, name: e.target.value }))} />
            <select value={task.assigneeEmployeeId} onChange={(e) => setTask((s) => ({ ...s, assigneeEmployeeId: e.target.value }))} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="">Unassigned</option>
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{empName(e)}</option>)}
            </select>
            <select value={task.priority} onChange={(e) => setTask((s) => ({ ...s, priority: e.target.value }))} className="h-10 rounded-md border bg-background px-2 text-sm">
              {PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Input className="w-40" type="date" value={task.dueDate} onChange={(e) => setTask((s) => ({ ...s, dueDate: e.target.value }))} />
            <Button size="sm" disabled={!task.name.trim() || addTask.isPending} onClick={() => addTask.mutate()}><Plus className="mr-1 h-4 w-4" /> Add task</Button>
          </div>
        </section>

        {/* Members */}
        <section className="border-t pt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Members</h3>
          <div className="space-y-1.5">
            {(p.members ?? []).map((mb) => (
              <div key={mb.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{mb.employeeName}{mb.role ? <span className="text-muted-foreground"> · {mb.role}</span> : null}</span>
                <span className="text-xs text-muted-foreground">cost {formatMoney(mb.costRate.amountMinor, mb.costRate.currency)} · bill {formatMoney(mb.billRate.amountMinor, mb.billRate.currency)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMember.mutate(mb.id)} title="Remove"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>
              </div>
            ))}
            {(p.members ?? []).length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No members yet.</p> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={member.employeeId} onChange={(e) => setMember((s) => ({ ...s, employeeId: e.target.value }))} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="">Employee</option>
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{empName(e)}</option>)}
            </select>
            <Input className="w-32" placeholder="Role" value={member.role} onChange={(e) => setMember((s) => ({ ...s, role: e.target.value }))} />
            <Input className="w-28" type="number" min={0} step="0.01" placeholder="Cost/hr" value={member.costRate} onChange={(e) => setMember((s) => ({ ...s, costRate: e.target.value }))} />
            <Input className="w-28" type="number" min={0} step="0.01" placeholder="Bill/hr" value={member.billRate} onChange={(e) => setMember((s) => ({ ...s, billRate: e.target.value }))} />
            <Button size="sm" disabled={!member.employeeId || addMember.isPending} onClick={() => addMember.mutate()}><Plus className="mr-1 h-4 w-4" /> Add member</Button>
          </div>
        </section>

        {/* Time entries */}
        <section className="border-t pt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time entries</h3>
          <div className="space-y-1.5">
            {(time.data ?? []).map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{e.employeeName} · {fmtDate(e.entryDate)} · {hrs(e.minutes)}{e.billable ? <span className="text-muted-foreground"> · billable</span> : null}</span>
                <ProjBadge status={e.status} />
                <span className="tabular-nums text-xs text-muted-foreground">{formatMoney(e.cost.amountMinor, e.cost.currency)}</span>
                {e.status === 'SUBMITTED' || e.status === 'DRAFT' ? (
                  <>
                    <Button size="sm" variant="outline" className="h-7" disabled={timeStatus.isPending} onClick={() => timeStatus.mutate({ entryId: e.id, status: 'APPROVED' })}><Check className="mr-1 h-3 w-3" /> Approve</Button>
                    <Button size="sm" variant="outline" className="h-7" disabled={timeStatus.isPending} onClick={() => timeStatus.mutate({ entryId: e.id, status: 'REJECTED' })}><X className="mr-1 h-3 w-3" /> Reject</Button>
                  </>
                ) : null}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteTime.mutate(e.id)} title="Delete"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>
              </div>
            ))}
            {(time.data ?? []).length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No time logged.</p> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={logForm.employeeId} onChange={(e) => setLogForm((s) => ({ ...s, employeeId: e.target.value }))} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="">Employee</option>
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{empName(e)}</option>)}
            </select>
            <select value={logForm.taskId} onChange={(e) => setLogForm((s) => ({ ...s, taskId: e.target.value }))} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="">No task</option>
              {(p.tasks ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Input className="w-40" type="date" value={logForm.entryDate} onChange={(e) => setLogForm((s) => ({ ...s, entryDate: e.target.value }))} />
            <Input className="w-24" type="number" min={0} placeholder="Minutes" value={logForm.minutes} onChange={(e) => setLogForm((s) => ({ ...s, minutes: e.target.value }))} />
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground"><input type="checkbox" checked={logForm.billable} onChange={(e) => setLogForm((s) => ({ ...s, billable: e.target.checked }))} /> Billable</label>
            <Input className="w-40" placeholder="Description" value={logForm.description} onChange={(e) => setLogForm((s) => ({ ...s, description: e.target.value }))} />
            <Button size="sm" disabled={!logForm.employeeId || !logForm.minutes || logTime.isPending} onClick={() => logTime.mutate()}><Plus className="mr-1 h-4 w-4" /> Log time</Button>
          </div>
        </section>

        {/* Expenses */}
        <section className="border-t pt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expenses</h3>
          <div className="space-y-1.5">
            {(expenses.data ?? []).map((x) => (
              <div key={x.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{fmtDate(x.expenseDate)} · {x.category ?? 'Expense'}{x.billable ? <span className="text-muted-foreground"> · billable</span> : null}</span>
                <span className="tabular-nums">{formatMoney(x.amount.amountMinor, x.amount.currency)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteExpense.mutate(x.id)} title="Delete"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>
              </div>
            ))}
            {(expenses.data ?? []).length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No expenses.</p> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="w-40" type="date" value={expense.expenseDate} onChange={(e) => setExpense((s) => ({ ...s, expenseDate: e.target.value }))} />
            <Input className="w-36" placeholder="Category" value={expense.category} onChange={(e) => setExpense((s) => ({ ...s, category: e.target.value }))} />
            <Input className="w-28" type="number" min={0} step="0.01" placeholder="Amount" value={expense.amount} onChange={(e) => setExpense((s) => ({ ...s, amount: e.target.value }))} />
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground"><input type="checkbox" checked={expense.billable} onChange={(e) => setExpense((s) => ({ ...s, billable: e.target.checked }))} /> Billable</label>
            <Input className="w-40" placeholder="Description" value={expense.description} onChange={(e) => setExpense((s) => ({ ...s, description: e.target.value }))} />
            <Button size="sm" disabled={!expense.amount || addExpense.isPending} onClick={() => addExpense.mutate()}><Plus className="mr-1 h-4 w-4" /> Add expense</Button>
          </div>
        </section>
      </PaneBody>
    </>
  );
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'rose' }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 truncate text-sm font-semibold tabular-nums ${tone === 'rose' ? 'text-rose-600' : ''}`}>{value}</p></div>;
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
