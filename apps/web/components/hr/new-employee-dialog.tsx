'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
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
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', salary: '', status: 'ACTIVE' });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/hr/employees', {
        firstName: form.firstName,
        lastName: form.lastName,
        ...(form.email ? { email: form.email } : {}),
        ...(form.salary ? { salary: { amountMinor: Math.round(Number(form.salary) * 100), currency: 'PKR' } } : {}),
        status: form.status,
      }),
    onSuccess: () => {
      toast.success('Employee added', { description: `${form.firstName} ${form.lastName}` });
      qc.invalidateQueries({ queryKey: ['employees'] });
      setOpen(false);
      setForm({ firstName: '', lastName: '', email: '', salary: '', status: 'ACTIVE' });
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>Create a new HR record for your company.</DialogDescription>
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
          <div className="space-y-2">
            <Label htmlFor="em">Email</Label>
            <Input id="em" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} placeholder="optional" />
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
