'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import type { LeaveRequest, LeaveType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { NewLeaveRequestDialog } from './new-leave-request-dialog';
import { NewLeaveTypeDialog } from './new-leave-type-dialog';
import { HrStatusBadge, fmtDate } from './hr-ui';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

interface TypeDraft { name: string; daysPerYear: string }

export function LeavePanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TypeDraft>({ name: '', daysPerYear: '' });

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const requests = useQuery({
    queryKey: ['leave-requests', status],
    queryFn: () => apiGet<LeaveRequest[]>(`/hr/leave-requests${status ? `?status=${status}` : ''}`),
  });
  const types = useQuery({ queryKey: ['leave-types'], queryFn: () => apiGet<LeaveType[]>('/hr/leave-types') });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      apiPatch(`/hr/leave-requests/${id}/decide`, { decision }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['leave-requests'] }); },
    onError: onErr,
  });

  const updateType = useMutation({
    mutationFn: ({ id, name, daysPerYear }: { id: string; name: string; daysPerYear: number }) =>
      apiPatch(`/hr/leave-types/${id}`, { name, daysPerYear }),
    onSuccess: () => { setEditId(null); void qc.invalidateQueries({ queryKey: ['leave-types'] }); },
    onError: onErr,
  });

  const removeType = useMutation({
    mutationFn: (id: string) => apiDelete(`/hr/leave-types/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['leave-types'] }); },
    onError: onErr,
  });

  const startEdit = (t: LeaveType) => { setEditId(t.id); setDraft({ name: t.name, daysPerYear: String(t.daysPerYear) }); };

  const reqList = requests.data ?? [];
  const typeList = types.data ?? [];

  return (
    <>
      <PaneHeader>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <NewLeaveTypeDialog />
          <NewLeaveRequestDialog />
        </div>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leave requests</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Leave #</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2 text-right">Days</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
              <tbody className="divide-y">
                {reqList.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.leaveNo}</td>
                    <td className="px-3 py-2 font-medium">{r.employeeName ?? '—'}</td>
                    <td className="px-3 py-2">{r.typeName ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.days}</td>
                    <td className="px-3 py-2"><HrStatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-right">
                      {r.status === 'PENDING' ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'APPROVE' })}>Approve</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'REJECT' })}>Reject</Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {reqList.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No leave requests.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leave types</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Code</th><th className="px-3 py-2 text-right">Days/yr</th><th className="px-3 py-2 text-center">Paid</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
              <tbody className="divide-y">
                {typeList.map((t) => (
                  <tr key={t.id}>
                    {editId === t.id ? (
                      <>
                        <td className="px-3 py-2"><Input value={draft.name} onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))} className="h-8" /></td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.code ?? '—'}</td>
                        <td className="px-3 py-2 text-right"><Input type="number" min="0" value={draft.daysPerYear} onChange={(e) => setDraft((s) => ({ ...s, daysPerYear: e.target.value }))} className="h-8 w-20 text-right" /></td>
                        <td className="px-3 py-2 text-center">{t.paid ? '✓' : '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" disabled={updateType.isPending || !draft.name.trim()} onClick={() => updateType.mutate({ id: t.id, name: draft.name, daysPerYear: Number(draft.daysPerYear) || 0 })}><Save className="size-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-medium">{t.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.code ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.daysPerYear}</td>
                        <td className="px-3 py-2 text-center">{t.paid ? '✓' : '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(t)}><Pencil className="size-4" /></Button>
                            <Button size="sm" variant="ghost" className="text-destructive" disabled={removeType.isPending} onClick={() => { if (confirm(`Delete leave type "${t.name}"?`)) removeType.mutate(t.id); }}><Trash2 className="size-4" /></Button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {typeList.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No leave types yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}
