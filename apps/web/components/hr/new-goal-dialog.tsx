'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiList, apiPost } from '@/lib/api';
import type { Employee } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function NewGoalDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const { data: employees } = useQuery({ queryKey: ['employees-all'], queryFn: () => apiList<Employee>('/hr/employees?pageSize=100') });

  const create = useMutation({
    mutationFn: () => apiPost('/hr/goals', { employeeId, title, targetDate: targetDate || undefined }),
    onSuccess: () => {
      toast.success('Goal added', { description: title });
      qc.invalidateQueries({ queryKey: ['goals'] });
      setOpen(false);
      setEmployeeId(''); setTitle(''); setTargetDate('');
    },
    onError: (e) => toast.error('Could not add goal', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="size-4" /> New goal</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New goal</DialogTitle>
          <DialogDescription>Track progress from 0–100%.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ge">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger id="ge"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{(employees?.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label htmlFor="gt">Title</Label><Input id="gt" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="gd">Target date</Label><Input id="gd" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !employeeId || !title.trim()}>{create.isPending ? 'Adding…' : 'Add goal'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
