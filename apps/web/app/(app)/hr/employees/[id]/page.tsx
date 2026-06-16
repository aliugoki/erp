'use client';
import { type FormEvent, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, GraduationCap, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import type { EmployeeProfile } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EditProfileDialog } from '@/components/hr/edit-profile-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || '—'}</span>
    </div>
  );
}

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const { data: e, isLoading } = useQuery({ queryKey: ['profile', id], queryFn: () => apiGet<EmployeeProfile>(`/hr/employees/${id}/profile`) });

  const [edu, setEdu] = useState({ degree: '', institution: '', endYear: '' });
  const [exp, setExp] = useState({ company: '', title: '', startDate: '', endDate: '' });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['profile', id] });
  const addEdu = useMutation({
    mutationFn: () => apiPost(`/hr/employees/${id}/education`, { degree: edu.degree, institution: edu.institution || undefined, endYear: edu.endYear ? Number(edu.endYear) : undefined }),
    onSuccess: () => { invalidate(); setEdu({ degree: '', institution: '', endYear: '' }); },
  });
  const delEdu = useMutation({ mutationFn: (eid: string) => apiDelete(`/hr/education/${eid}`), onSuccess: invalidate });
  const addExp = useMutation({
    mutationFn: () => apiPost(`/hr/employees/${id}/experience`, { company: exp.company, title: exp.title || undefined, startDate: exp.startDate || undefined, endDate: exp.endDate || undefined }),
    onSuccess: () => { invalidate(); setExp({ company: '', title: '', startDate: '', endDate: '' }); },
  });
  const delExp = useMutation({ mutationFn: (xid: string) => apiDelete(`/hr/experience/${xid}`), onSuccess: invalidate });

  if (isLoading || !e) {
    return <div className="mx-auto max-w-5xl space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48 w-full" /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <Link href="/hr" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Employees</Link>
      <PageHeader
        title={`${e.firstName} ${e.lastName}`}
        description={`${e.designation ?? 'No designation'} · ${e.employeeCode}`}
        action={<EditProfileDialog employee={e} />}
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="p-4">
          <p className="mb-2 font-medium">Job</p>
          <Field label="Designation" value={e.designation} />
          <Field label="Employment" value={e.employmentType?.replace('_', ' ').toLowerCase()} />
          <Field label="Status" value={e.status.replace('_', ' ').toLowerCase()} />
          <Field label="Joined" value={e.joinDate} />
          <Field label="Confirmed" value={e.confirmationDate} />
          <Field label="Work location" value={e.workLocation} />
          <Field label="Salary" value={e.salary ? formatMoney(e.salary.amountMinor, e.salary.currency) : null} />
        </Card>
        <Card className="p-4">
          <p className="mb-2 font-medium">Personal</p>
          <Field label="Date of birth" value={e.dateOfBirth} />
          <Field label="Gender" value={e.gender?.toLowerCase()} />
          <Field label="Marital status" value={e.maritalStatus} />
          <Field label="National ID" value={e.nationalId} />
          <Field label="Blood group" value={e.bloodGroup} />
          <Field label="Nationality" value={e.nationality} />
        </Card>
        <Card className="p-4">
          <p className="mb-2 font-medium">Contact</p>
          <Field label="Email" value={e.email} />
          <Field label="Phone" value={e.phone} />
          <Field label="Address" value={e.address} />
          <Field label="City" value={e.city} />
          <Field label="Country" value={e.country} />
          <Field label="Emergency" value={e.emergencyContactName ? `${e.emergencyContactName} · ${e.emergencyContactPhone ?? ''}` : null} />
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 flex items-center gap-2 font-medium"><GraduationCap className="size-4" /> Education</p>
          <ul className="mb-3 space-y-2">
            {e.education.map((ed) => (
              <li key={ed.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <span><span className="font-medium">{ed.degree}</span>{ed.institution ? ` · ${ed.institution}` : ''}{ed.endYear ? <Badge variant="secondary" className="ml-2 text-[10px]">{ed.endYear}</Badge> : null}</span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => delEdu.mutate(ed.id)}><Trash2 className="size-3.5" /></Button>
              </li>
            ))}
            {e.education.length === 0 ? <li className="text-sm text-muted-foreground">No academic records.</li> : null}
          </ul>
          <form className="flex flex-wrap gap-2" onSubmit={(ev: FormEvent) => { ev.preventDefault(); addEdu.mutate(); }}>
            <Input value={edu.degree} onChange={(e) => setEdu((s) => ({ ...s, degree: e.target.value }))} placeholder="Degree" className="flex-1" required />
            <Input value={edu.institution} onChange={(e) => setEdu((s) => ({ ...s, institution: e.target.value }))} placeholder="Institution" className="flex-1" />
            <Input value={edu.endYear} onChange={(e) => setEdu((s) => ({ ...s, endYear: e.target.value }))} placeholder="Year" type="number" className="w-20" />
            <Button type="submit" size="sm" disabled={addEdu.isPending || !edu.degree.trim()}><Plus className="size-4" /></Button>
          </form>
        </Card>

        <Card className="p-4">
          <p className="mb-3 flex items-center gap-2 font-medium"><Briefcase className="size-4" /> Work experience</p>
          <ul className="mb-3 space-y-2">
            {e.experience.map((x) => (
              <li key={x.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <span><span className="font-medium">{x.title ?? 'Role'}</span> · {x.company}{x.startDate ? <span className="text-xs text-muted-foreground"> ({x.startDate.slice(0, 7)}{x.endDate ? `–${x.endDate.slice(0, 7)}` : '–now'})</span> : null}</span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => delExp.mutate(x.id)}><Trash2 className="size-3.5" /></Button>
              </li>
            ))}
            {e.experience.length === 0 ? <li className="text-sm text-muted-foreground">No prior experience.</li> : null}
          </ul>
          <form className="flex flex-wrap gap-2" onSubmit={(ev: FormEvent) => { ev.preventDefault(); addExp.mutate(); }}>
            <Input value={exp.company} onChange={(e) => setExp((s) => ({ ...s, company: e.target.value }))} placeholder="Company" className="flex-1" required />
            <Input value={exp.title} onChange={(e) => setExp((s) => ({ ...s, title: e.target.value }))} placeholder="Title" className="flex-1" />
            <Button type="submit" size="sm" disabled={addExp.isPending || !exp.company.trim()}><Plus className="size-4" /></Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
