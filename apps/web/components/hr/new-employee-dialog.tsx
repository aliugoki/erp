'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost, apiUpload } from '@/lib/api';
import type { Department, Designation } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function NewEmployeeDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const EMPTY = { firstName: '', lastName: '', email: '', phone: '', salary: '', status: 'ACTIVE', designation: '', departmentId: '', employmentType: '', joinDate: '', city: '' };
  const [form, setForm] = useState(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const departments = useQuery({ queryKey: ['departments'], queryFn: () => apiGet<Department[]>('/hr/departments') });
  const designations = useQuery({ queryKey: ['designations'], queryFn: () => apiGet<Designation[]>('/hr/designations') });

  const create = useMutation({
    mutationFn: async () => {
      const employee = await apiPost<{ id: string }>('/hr/employees', {
        firstName: form.firstName,
        lastName: form.lastName,
        ...(form.email ? { email: form.email } : {}),
        ...(form.phone ? { phone: form.phone } : {}),
        ...(form.salary ? { salary: { amountMinor: Math.round(Number(form.salary) * 100), currency: 'PKR' } } : {}),
        status: form.status,
        ...(form.designation ? { designation: form.designation } : {}),
        ...(form.departmentId ? { departmentId: form.departmentId } : {}),
        ...(form.employmentType ? { employmentType: form.employmentType } : {}),
        ...(form.joinDate ? { joinDate: form.joinDate } : {}),
        ...(form.city ? { city: form.city } : {}),
      });
      if (photo) {
        const fd = new FormData();
        fd.append('file', photo);
        await apiUpload(`/hr/employees/${employee.id}/photo`, fd);
      }
      return employee;
    },
    onSuccess: () => {
      toast.success('Employee added', { description: `${form.firstName} ${form.lastName}` });
      qc.invalidateQueries({ queryKey: ['employees'] });
      setOpen(false);
      setForm(EMPTY);
      setPhoto(null);
    },
    onError: (e) => toast.error('Could not add employee', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>Core details now; complete the full profile from the employee page.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fn">First name</Label>
              <Input id="fn" value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ln">Last name</Label>
              <Input id="ln" value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="em">Email</Label>
              <Input id="em" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} placeholder="optional" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ph">Phone</Label>
              <Input id="ph" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dept">Department</Label>
              <Select value={form.departmentId} onValueChange={set('departmentId')}>
                <SelectTrigger id="dept"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(departments.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dg">Designation</Label>
              <Select value={form.designation} onValueChange={set('designation')}>
                <SelectTrigger id="dg"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(designations.data ?? []).map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="et">Employment type</Label>
            <Select value={form.employmentType} onValueChange={set('employmentType')}>
              <SelectTrigger id="et"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'PROBATION'].map((t) => <SelectItem key={t} value={t}>{t.replace('_', ' ').toLowerCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="jd">Join date</Label>
              <Input id="jd" type="date" value={form.joinDate} onChange={(e) => set('joinDate')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ci">City</Label>
              <Input id="ci" value={form.city} onChange={(e) => set('city')(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sal">Salary (PKR)</Label>
              <Input id="sal" type="number" min="0" value={form.salary} onChange={(e) => set('salary')(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={set('status')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="ON_LEAVE">On leave</SelectItem>
                  <SelectItem value="TERMINATED">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="photo">Photo</Label>
            <Input
              id="photo"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">Optional — JPEG/PNG/WebP/GIF, up to 8 MB.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add employee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
