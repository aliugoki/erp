'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, CalendarRange, FileText, GraduationCap, History, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import type { EmployeeProfile } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthImage } from '@/components/auth-image';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { EditProfileDialog } from '@/components/hr/edit-profile-dialog';
import { HrStatusBadge, fmtDate } from './hr-ui';

interface LeaveBalance { id: string; leaveTypeId: string; year: number; entitledDays: number; usedDays: number; remainingDays: number; typeName: string }
interface LeaveType { id: string; name: string }
interface HistoryRow { id: string; eventType: string; effectiveDate: string; fromValue: string | null; toValue: string | null; detail: string | null }
interface HrDocument { id: string; title: string; docType: string | null; note: string | null }

const EVENT_TYPES = ['PROMOTED', 'TRANSFERRED', 'SALARY_CHANGE', 'STATUS_CHANGE', 'OTHER'];
const today = () => new Date().toISOString().slice(0, 10);

export function EmployeeDetail({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ['profile', id], queryFn: () => apiGet<EmployeeProfile>(`/hr/employees/${id}/profile`) });
  const balances = useQuery({ queryKey: ['leave-balances', id], queryFn: () => apiGet<LeaveBalance[]>(`/hr/leave-balances/${id}`) });
  const leaveTypes = useQuery({ queryKey: ['leave-types'], queryFn: () => apiGet<LeaveType[]>('/hr/leave-types') });
  const history = useQuery({ queryKey: ['hr-history', id], queryFn: () => apiGet<HistoryRow[]>(`/hr/employees/${id}/history`) });
  const docs = useQuery({ queryKey: ['hr-docs', id], queryFn: () => apiGet<HrDocument[]>(`/hr/documents/${id}`) });

  const [edu, setEdu] = useState({ degree: '', institution: '', endYear: '' });
  const [exp, setExp] = useState({ company: '', title: '', startDate: '', endDate: '' });
  const [bal, setBal] = useState({ leaveTypeId: '', year: String(new Date().getFullYear()), entitledDays: '' });
  const [evt, setEvt] = useState({ eventType: 'PROMOTED', note: '', effectiveDate: today() });
  const [doc, setDoc] = useState({ title: '', docType: '', note: '' });

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const inv = (key: unknown[]) => () => void qc.invalidateQueries({ queryKey: key });

  const addEdu = useMutation({
    mutationFn: () => apiPost(`/hr/employees/${id}/education`, { degree: edu.degree, institution: edu.institution || undefined, endYear: edu.endYear ? Number(edu.endYear) : undefined }),
    onSuccess: () => { inv(['profile', id])(); setEdu({ degree: '', institution: '', endYear: '' }); }, onError: onErr,
  });
  const delEdu = useMutation({ mutationFn: (eid: string) => apiDelete(`/hr/education/${eid}`), onSuccess: inv(['profile', id]), onError: onErr });
  const addExp = useMutation({
    mutationFn: () => apiPost(`/hr/employees/${id}/experience`, { company: exp.company, title: exp.title || undefined, startDate: exp.startDate || undefined, endDate: exp.endDate || undefined }),
    onSuccess: () => { inv(['profile', id])(); setExp({ company: '', title: '', startDate: '', endDate: '' }); }, onError: onErr,
  });
  const delExp = useMutation({ mutationFn: (xid: string) => apiDelete(`/hr/experience/${xid}`), onSuccess: inv(['profile', id]), onError: onErr });

  const setBalance = useMutation({
    mutationFn: () => apiPost('/hr/leave-balances', { employeeId: id, leaveTypeId: bal.leaveTypeId, year: Number(bal.year), entitledDays: Number(bal.entitledDays) }),
    onSuccess: () => { toast.success('Leave balance saved'); inv(['leave-balances', id])(); setBal((s) => ({ ...s, entitledDays: '' })); }, onError: onErr,
  });
  const recordEvent = useMutation({
    mutationFn: () => apiPost(`/hr/employees/${id}/lifecycle`, { eventType: evt.eventType, note: evt.note || undefined, effectiveDate: evt.effectiveDate ? new Date(evt.effectiveDate).toISOString() : undefined }),
    onSuccess: () => {
      toast.success('Event recorded');
      inv(['hr-history', id])(); inv(['profile', id])(); inv(['employees'])();
      setEvt({ eventType: 'PROMOTED', note: '', effectiveDate: today() });
    }, onError: onErr,
  });
  const addDoc = useMutation({
    mutationFn: () => apiPost('/hr/documents', { employeeId: id, title: doc.title, docType: doc.docType || undefined, note: doc.note || undefined }),
    onSuccess: () => { toast.success('Document added'); inv(['hr-docs', id])(); setDoc({ title: '', docType: '', note: '' }); }, onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/hr/employees/${id}`),
    onSuccess: () => { toast.success('Employee deleted'); void qc.invalidateQueries({ queryKey: ['employees'] }); onDeleted?.(); }, onError: onErr,
  });

  if (profile.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (profile.isError || !profile.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Employee not found.</div>;
  const p = profile.data;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <AuthImage path={`/hr/employees/${id}/photo`} alt={`${p.firstName} ${p.lastName}`} className="h-9 w-9 shrink-0 rounded-full border object-cover" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{p.firstName} {p.lastName}</span>
          <span className="font-mono text-xs text-muted-foreground">{p.employeeCode}</span>
          <HrStatusBadge status={p.status} />
        </div>
        <EditProfileDialog employee={p} />
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this employee?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Job">
            <Field label="Designation" value={p.designation} />
            <Field label="Employment" value={p.employmentType?.replace('_', ' ').toLowerCase()} />
            <Field label="Status" value={p.status.replace('_', ' ').toLowerCase()} />
            <Field label="Joined" value={fmtDate(p.joinDate)} />
            <Field label="Confirmed" value={fmtDate(p.confirmationDate)} />
            <Field label="Work location" value={p.workLocation} />
            <Field label="Salary" value={p.salary ? formatMoney(p.salary.amountMinor, p.salary.currency) : null} />
          </Card>
          <Card title="Personal">
            <Field label="Date of birth" value={fmtDate(p.dateOfBirth)} />
            <Field label="Gender" value={p.gender?.toLowerCase()} />
            <Field label="Marital status" value={p.maritalStatus} />
            <Field label="National ID" value={p.nationalId} />
            <Field label="Blood group" value={p.bloodGroup} />
            <Field label="Nationality" value={p.nationality} />
          </Card>
          <Card title="Contact">
            <Field label="Email" value={p.email} />
            <Field label="Phone" value={p.phone} />
            <Field label="Address" value={p.address} />
            <Field label="City" value={p.city} />
            <Field label="Country" value={p.country} />
            <Field label="Emergency" value={p.emergencyContactName ? `${p.emergencyContactName} · ${p.emergencyContactPhone ?? ''}` : null} />
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><GraduationCap className="size-4" /> Education</h3>
            <ul className="mb-3 space-y-2">
              {p.education.map((ed) => (
                <li key={ed.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span><span className="font-medium">{ed.degree}</span>{ed.institution ? ` · ${ed.institution}` : ''}{ed.endYear ? <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{ed.endYear}</span> : null}</span>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => delEdu.mutate(ed.id)}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
              {p.education.length === 0 ? <li className="text-sm text-muted-foreground">No academic records.</li> : null}
            </ul>
            <form className="flex flex-wrap gap-2" onSubmit={(ev: FormEvent) => { ev.preventDefault(); addEdu.mutate(); }}>
              <Input value={edu.degree} onChange={(e) => setEdu((s) => ({ ...s, degree: e.target.value }))} placeholder="Degree" className="h-8 flex-1" required />
              <Input value={edu.institution} onChange={(e) => setEdu((s) => ({ ...s, institution: e.target.value }))} placeholder="Institution" className="h-8 flex-1" />
              <Input value={edu.endYear} onChange={(e) => setEdu((s) => ({ ...s, endYear: e.target.value }))} placeholder="Year" type="number" className="h-8 w-20" />
              <Button type="submit" size="sm" disabled={addEdu.isPending || !edu.degree.trim()}><Plus className="size-4" /></Button>
            </form>
          </section>

          <section className="rounded-xl border p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Briefcase className="size-4" /> Work experience</h3>
            <ul className="mb-3 space-y-2">
              {p.experience.map((x) => (
                <li key={x.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span><span className="font-medium">{x.title ?? 'Role'}</span> · {x.company}{x.startDate ? <span className="text-xs text-muted-foreground"> ({x.startDate.slice(0, 7)}{x.endDate ? `–${x.endDate.slice(0, 7)}` : '–now'})</span> : null}</span>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => delExp.mutate(x.id)}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
              {p.experience.length === 0 ? <li className="text-sm text-muted-foreground">No prior experience.</li> : null}
            </ul>
            <form className="flex flex-wrap gap-2" onSubmit={(ev: FormEvent) => { ev.preventDefault(); addExp.mutate(); }}>
              <Input value={exp.company} onChange={(e) => setExp((s) => ({ ...s, company: e.target.value }))} placeholder="Company" className="h-8 flex-1" required />
              <Input value={exp.title} onChange={(e) => setExp((s) => ({ ...s, title: e.target.value }))} placeholder="Title" className="h-8 flex-1" />
              <Button type="submit" size="sm" disabled={addExp.isPending || !exp.company.trim()}><Plus className="size-4" /></Button>
            </form>
          </section>
        </div>

        <section className="rounded-xl border p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarRange className="size-4" /> Leave balances</h3>
          <div className="mb-3 overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Year</th><th className="px-3 py-2 text-right">Entitled</th><th className="px-3 py-2 text-right">Used</th><th className="px-3 py-2 text-right">Remaining</th></tr></thead>
              <tbody className="divide-y">
                {(balances.data ?? []).map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-medium">{b.typeName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.year}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.entitledDays}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.usedDays}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{b.remainingDays}</td>
                  </tr>
                ))}
                {(balances.data ?? []).length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No balances set.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(ev: FormEvent) => { ev.preventDefault(); setBalance.mutate(); }}>
            <select value={bal.leaveTypeId} onChange={(e) => setBal((s) => ({ ...s, leaveTypeId: e.target.value }))} className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" required>
              <option value="">Leave type…</option>
              {(leaveTypes.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Input value={bal.year} onChange={(e) => setBal((s) => ({ ...s, year: e.target.value }))} type="number" placeholder="Year" className="h-8 w-24" required />
            <Input value={bal.entitledDays} onChange={(e) => setBal((s) => ({ ...s, entitledDays: e.target.value }))} type="number" min={0} placeholder="Entitled" className="h-8 w-28" required />
            <Button type="submit" size="sm" disabled={setBalance.isPending || !bal.leaveTypeId || !bal.entitledDays}><Plus className="size-4" /> Set balance</Button>
          </form>
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><History className="size-4" /> Lifecycle history</h3>
          <ol className="mb-3 space-y-2 border-l pl-4">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="relative text-sm">
                <span className="absolute -left-[1.30rem] top-1.5 h-2 w-2 rounded-full bg-primary" />
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{h.eventType.replace('_', ' ').toLowerCase()}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(h.effectiveDate)}</span>
                </div>
                {h.fromValue || h.toValue ? <p className="text-xs text-muted-foreground">{h.fromValue ?? '—'} → {h.toValue ?? '—'}</p> : null}
                {h.detail ? <p className="text-xs text-muted-foreground">{h.detail}</p> : null}
              </li>
            ))}
            {(history.data ?? []).length === 0 ? <li className="text-sm text-muted-foreground">No events recorded.</li> : null}
          </ol>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(ev: FormEvent) => { ev.preventDefault(); recordEvent.mutate(); }}>
            <select value={evt.eventType} onChange={(e) => setEvt((s) => ({ ...s, eventType: e.target.value }))} className="h-8 rounded-md border bg-background px-2 text-sm">
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ').toLowerCase()}</option>)}
            </select>
            <Input value={evt.note} onChange={(e) => setEvt((s) => ({ ...s, note: e.target.value }))} placeholder="Note" className="h-8 flex-1" />
            <Input value={evt.effectiveDate} onChange={(e) => setEvt((s) => ({ ...s, effectiveDate: e.target.value }))} type="date" className="h-8 w-40" />
            <Button type="submit" size="sm" disabled={recordEvent.isPending}><Plus className="size-4" /> Record event</Button>
          </form>
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" /> Documents</h3>
          <ul className="mb-3 space-y-2">
            {(docs.data ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <span><span className="font-medium">{d.title}</span>{d.docType ? <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">{d.docType}</span> : null}{d.note ? <span className="text-xs text-muted-foreground"> · {d.note}</span> : null}</span>
              </li>
            ))}
            {(docs.data ?? []).length === 0 ? <li className="text-sm text-muted-foreground">No documents.</li> : null}
          </ul>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(ev: FormEvent) => { ev.preventDefault(); addDoc.mutate(); }}>
            <Input value={doc.title} onChange={(e) => setDoc((s) => ({ ...s, title: e.target.value }))} placeholder="Title" className="h-8 flex-1" required />
            <Input value={doc.docType} onChange={(e) => setDoc((s) => ({ ...s, docType: e.target.value }))} placeholder="Type" className="h-8 w-32" />
            <Input value={doc.note} onChange={(e) => setDoc((s) => ({ ...s, note: e.target.value }))} placeholder="Note" className="h-8 flex-1" />
            <Button type="submit" size="sm" disabled={addDoc.isPending || !doc.title.trim()}><Plus className="size-4" /> Add document</Button>
          </form>
        </section>
      </PaneBody>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border p-4"><p className="mb-2 font-medium">{title}</p>{children}</div>;
}
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || '—'}</span>
    </div>
  );
}
