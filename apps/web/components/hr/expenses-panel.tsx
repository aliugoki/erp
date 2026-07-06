'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, Branch, CostCenter, Employee, ExpenseClaim } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';

const NONE = '__none__';
const today = () => new Date().toISOString().slice(0, 10);
const toMinor = (v: string) => Math.round((Number(v) || 0) * 100);
const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground', SUBMITTED: 'bg-sky-500/10 text-sky-600', APPROVED: 'bg-amber-500/10 text-amber-600',
  PAID: 'bg-emerald-500/10 text-emerald-600', REJECTED: 'bg-destructive/10 text-destructive',
};
interface LineDraft { description: string; amount: string; expenseAccountId: string }
const emptyLine = (): LineDraft => ({ description: '', amount: '', expenseAccountId: NONE });

/** Employee expense claims — submit, approve/reject, and reimburse (posts to the GL when a cash/bank
 * account is chosen). Rendered as the HR → Expenses section. */
export function ExpensesPanel() {
  const qc = useQueryClient();
  const claims = useQuery({ queryKey: ['expense-claims'], queryFn: () => apiGet<ExpenseClaim[]>('/expense-claims') });
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => apiGet<Employee[]>('/hr/employees?pageSize=200') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => apiGet<Branch[]>('/branches') });
  const costCenters = useQuery({ queryKey: ['cost-centers'], queryFn: () => apiGet<CostCenter[]>('/finance/cost-centers'), retry: false });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), retry: false });
  const expenseAccts = (accounts.data ?? []).filter((a) => !a.isGroup && a.type === 'EXPENSE');
  const cashBankAccts = (accounts.data ?? []).filter((a) => !a.isGroup && (a.controlType === 'CASH' || a.controlType === 'BANK'));

  const [open, setOpen] = useState(false);
  const [emp, setEmp] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today());
  const [branchId, setBranchId] = useState(NONE);
  const [costCenterId, setCostCenterId] = useState(NONE);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const setLine = (i: number, p: Partial<LineDraft>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const resetForm = () => { setEmp(''); setTitle(''); setDate(today()); setBranchId(NONE); setCostCenterId(NONE); setLines([emptyLine()]); };

  const [payFor, setPayFor] = useState<ExpenseClaim | null>(null);
  const [payAccount, setPayAccount] = useState('');

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['expense-claims'] }); void qc.invalidateQueries({ queryKey: ['transactions'] }); };

  const create = useMutation({
    mutationFn: () => apiPost('/expense-claims', {
      employeeId: emp,
      title: title || undefined,
      claimDate: date || undefined,
      branchId: branchId === NONE ? undefined : branchId,
      costCenterId: costCenterId === NONE ? undefined : costCenterId,
      lines: lines.filter((l) => l.description.trim() && toMinor(l.amount) > 0).map((l) => ({
        description: l.description.trim(), amountMinor: toMinor(l.amount),
        ...(l.expenseAccountId !== NONE ? { expenseAccountId: l.expenseAccountId } : {}),
      })),
    }),
    onSuccess: () => { toast.success('Claim created'); refresh(); setOpen(false); resetForm(); },
    onError: onErr,
  });
  const act = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body?: unknown }) => apiPost(`/expense-claims/${id}/${path}`, body ?? {}),
    onSuccess: () => { toast.success('Done'); refresh(); },
    onError: onErr,
  });
  const pay = useMutation({
    mutationFn: () => apiPost(`/expense-claims/${payFor!.id}/pay`, payAccount ? { paymentAccountId: payAccount } : {}),
    onSuccess: () => { toast.success('Reimbursed'); refresh(); setPayFor(null); setPayAccount(''); },
    onError: onErr,
  });

  const draftTotal = lines.reduce((s, l) => s + toMinor(l.amount), 0);
  const validForm = !!emp && lines.some((l) => l.description.trim() && toMinor(l.amount) > 0);
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (validForm) create.mutate(); };
  const rows = claims.data ?? [];

  return (
    <>
      <PaneHeader>
        <span className="flex items-center gap-2 text-sm font-medium"><Wallet className="size-4 text-primary" /> Expense claims</span>
        <div className="ml-auto">
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> New claim</Button></DialogTrigger>
            <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
              <DialogHeader><DialogTitle>New expense claim</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">Employee</Label>
                    <Select value={emp} onValueChange={setEmp}>
                      <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                      <SelectContent>{(employees.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client visit — Lahore" /></div>
                <div className="grid grid-cols-2 gap-3">
                  {(branches.data ?? []).length > 0 ? (
                    <div className="space-y-1.5"><Label className="text-xs">Branch</Label>
                      <Select value={branchId} onValueChange={setBranchId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>—</SelectItem>{(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select>
                    </div>
                  ) : null}
                  {(costCenters.data ?? []).length > 0 ? (
                    <div className="space-y-1.5"><Label className="text-xs">Cost center</Label>
                      <Select value={costCenterId} onValueChange={setCostCenterId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>—</SelectItem>{(costCenters.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}</SelectContent></Select>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Lines</Label>
                  {lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-[1fr_7rem_10rem_2rem] items-center gap-2">
                      <Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" />
                      <Input type="number" min="0" step="0.01" className="text-right" placeholder="0.00" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
                      <Select value={l.expenseAccountId} onValueChange={(v) => setLine(i, { expenseAccountId: v })}>
                        <SelectTrigger><SelectValue placeholder="Expense a/c" /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>— (no GL)</SelectItem>{expenseAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button type="button" variant="ghost" size="icon" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Plus className="size-4" /> Add line</Button>
                    <span className="text-sm font-semibold tabular-nums">Total: {formatMoney(draftTotal, 'PKR')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Set an expense account on each line to reimburse it to the general ledger later; leave blank for a sub-ledger-only claim.</p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={!validForm || create.isPending}>{create.isPending ? 'Saving…' : 'Create claim'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </PaneHeader>

      <PaneBody className="p-5">
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Claim</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Title</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{c.claimNo}</td>
                  <td className="px-3 py-2">{c.employeeName ?? '—'}{c.branchName ? <span className="text-xs text-muted-foreground"> · {c.branchName}</span> : ''}</td>
                  <td className="px-3 py-2">{c.title || '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(c.total.amountMinor, c.total.currency)}</td>
                  <td className="px-3 py-2"><Badge className={STATUS_TONE[c.status]}>{c.status}</Badge>{c.journalVoucherNo ? <span className="ml-1 font-mono text-[10px] text-emerald-600">{c.journalVoucherNo}</span> : ''}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {c.status === 'DRAFT' ? <Button size="sm" variant="outline" className="h-7" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, path: 'submit' })}>Submit</Button> : null}
                      {c.status === 'SUBMITTED' ? <>
                        <Button size="sm" variant="outline" className="h-7 text-emerald-600" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, path: 'decide', body: { decision: 'APPROVED' } })}><Check className="size-3.5" /> Approve</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, path: 'decide', body: { decision: 'REJECTED' } })}><X className="size-3.5" /> Reject</Button>
                      </> : null}
                      {c.status === 'APPROVED' ? <Button size="sm" className="h-7" onClick={() => { setPayFor(c); setPayAccount(''); }}>Reimburse</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No expense claims yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </PaneBody>

      <Dialog open={!!payFor} onOpenChange={(v) => { if (!v) setPayFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reimburse {payFor?.claimNo}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Reimbursing <span className="font-semibold">{payFor ? formatMoney(payFor.total.amountMinor, payFor.total.currency) : ''}</span> to {payFor?.employeeName}.</p>
            <div className="space-y-1.5"><Label className="text-xs">Pay from (cash / bank) — posts to the GL</Label>
              <Select value={payAccount} onValueChange={setPayAccount}>
                <SelectTrigger><SelectValue placeholder="Optional — leave blank to mark paid without a GL entry" /></SelectTrigger>
                <SelectContent>{cashBankAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name} ({a.controlType})</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Posting requires every line to have an expense account.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayFor(null)}>Cancel</Button>
            <Button disabled={pay.isPending} onClick={() => pay.mutate()}>{pay.isPending ? 'Saving…' : 'Reimburse'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
