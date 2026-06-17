'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { CrmClient, Employee } from '@/lib/types';
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

const BILLING = [
  { v: 'TIME_MATERIALS', l: 'Time & materials' },
  { v: 'FIXED', l: 'Fixed price' },
  { v: 'NON_BILLABLE', l: 'Non-billable' },
];

export function NewProjectDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const EMPTY = { name: '', code: '', clientId: '', managerEmployeeId: '', billingType: 'TIME_MATERIALS', budget: '', startDate: '', endDate: '' };
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const clients = useQuery({ queryKey: ['crm-clients'], queryFn: () => apiGet<CrmClient[]>('/crm/clients'), enabled: open, retry: false });
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => apiGet<Employee[]>('/hr/employees'), enabled: open, retry: false });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/projects', {
        name: form.name,
        ...(form.code ? { code: form.code } : {}),
        ...(form.clientId ? { clientId: form.clientId } : {}),
        ...(form.managerEmployeeId ? { managerEmployeeId: form.managerEmployeeId } : {}),
        billingType: form.billingType,
        ...(form.budget ? { budgetMinor: Math.round(Number(form.budget) * 100) } : {}),
        ...(form.startDate ? { startDate: form.startDate } : {}),
        ...(form.endDate ? { endDate: form.endDate } : {}),
      }),
    onSuccess: () => {
      toast.success('Project created');
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-portfolio'] });
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e) => toast.error('Could not create project', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(EMPTY); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New project</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>For a client, run by a manager; track tasks, time, and cost vs budget.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pn">Name</Label>
              <Input id="pn" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Website rebuild" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pc">Code</Label>
              <Input id="pc" value={form.code} onChange={(e) => set('code')(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={form.clientId} onValueChange={set('clientId')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{(clients.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Manager</Label>
              <Select value={form.managerEmployeeId} onValueChange={set('managerEmployeeId')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{(employees.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Billing</Label>
              <Select value={form.billingType} onValueChange={set('billingType')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BILLING.map((b) => <SelectItem key={b.v} value={b.v}>{b.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pb">Budget (PKR)</Label>
              <Input id="pb" type="number" min="0" step="0.01" value={form.budget} onChange={(e) => set('budget')(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ps">Start</Label>
              <Input id="ps" type="date" value={form.startDate} onChange={(e) => set('startDate')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pe">End</Label>
              <Input id="pe" type="date" value={form.endDate} onChange={(e) => set('endDate')(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create project'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
