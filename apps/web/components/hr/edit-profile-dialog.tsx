'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { Branch, EmployeeProfile } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EMP_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'PROBATION'];

/** Edit the extended profile (personal + contact + job) of an employee. */
export function EditProfileDialog({ employee }: { employee: EmployeeProfile }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    designation: employee.designation ?? '',
    employmentType: employee.employmentType ?? '',
    dateOfBirth: employee.dateOfBirth ?? '',
    gender: employee.gender ?? '',
    maritalStatus: employee.maritalStatus ?? '',
    nationalId: employee.nationalId ?? '',
    bloodGroup: employee.bloodGroup ?? '',
    nationality: employee.nationality ?? '',
    address: employee.address ?? '',
    city: employee.city ?? '',
    country: employee.country ?? '',
    emergencyContactName: employee.emergencyContactName ?? '',
    emergencyContactPhone: employee.emergencyContactPhone ?? '',
    workLocation: employee.workLocation ?? '',
    branchId: employee.branchId ?? '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => apiGet<Branch[]>('/branches') });

  const save = useMutation({
    mutationFn: () => apiPatch(`/hr/employees/${employee.id}/profile`, {
      ...f,
      gender: f.gender || undefined,
      employmentType: f.employmentType || undefined,
      dateOfBirth: f.dateOfBirth || undefined,
      branchId: f.branchId || undefined,
    }),
    onSuccess: () => {
      toast.success('Profile updated');
      qc.invalidateQueries({ queryKey: ['profile', employee.id] });
      setOpen(false);
    },
    onError: (e) => toast.error('Could not update', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <div className="space-y-2"><Label htmlFor={k}>{label}</Label><Input id={k} type={type} value={f[k]} onChange={(e) => set(k)(e.target.value)} /></div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Pencil className="size-4" /> Edit profile</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>{employee.firstName} {employee.lastName} · {employee.employeeCode}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {field('designation', 'Designation')}
            <div className="space-y-2">
              <Label htmlFor="et">Employment type</Label>
              <Select value={f.employmentType} onValueChange={set('employmentType')}>
                <SelectTrigger id="et"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{EMP_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace('_', ' ').toLowerCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('dateOfBirth', 'Date of birth', 'date')}
            <div className="space-y-2">
              <Label htmlFor="gn">Gender</Label>
              <Select value={f.gender} onValueChange={set('gender')}>
                <SelectTrigger id="gn"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{['MALE', 'FEMALE', 'OTHER'].map((g) => <SelectItem key={g} value={g}>{g.toLowerCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">{field('maritalStatus', 'Marital status')}{field('nationalId', 'National ID / CNIC')}</div>
          <div className="grid grid-cols-2 gap-3">{field('bloodGroup', 'Blood group')}{field('nationality', 'Nationality')}</div>
          <div className="space-y-2"><Label htmlFor="address">Address</Label><Input id="address" value={f.address} onChange={(e) => set('address')(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">{field('city', 'City')}{field('country', 'Country')}</div>
          <div className="grid grid-cols-2 gap-3">{field('emergencyContactName', 'Emergency contact')}{field('emergencyContactPhone', 'Emergency phone')}</div>
          <div className="grid grid-cols-2 gap-3">
            {field('workLocation', 'Work location')}
            <div className="space-y-2">
              <Label htmlFor="br">Branch</Label>
              <Select value={f.branchId} onValueChange={set('branchId')}>
                <SelectTrigger id="br"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.city ? ` · ${b.city}` : ''}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
