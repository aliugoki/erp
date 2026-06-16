'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiList, apiPost } from '@/lib/api';
import type { Employee, LeaveType } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function NewLeaveRequestDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const { data: employees } = useQuery({ queryKey: ['employees-all'], queryFn: () => apiList<Employee>('/hr/employees?pageSize=100') });
  const { data: types } = useQuery({ queryKey: ['leave-types'], queryFn: () => apiGet<LeaveType[]>('/hr/leave-types') });

  const create = useMutation({
    mutationFn: () => apiPost('/hr/leave-requests', { employeeId, leaveTypeId, startDate, endDate, reason: reason || undefined }),
    onSuccess: () => {
      toast.success('Leave request submitted');
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['leave-summary'] });
      setOpen(false);
      setEmployeeId(''); setLeaveTypeId(''); setStartDate(''); setEndDate(''); setReason('');
    },
    onError: (e) => toast.error('Could not submit request', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> New request</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New leave request</DialogTitle>
          <DialogDescription>Days are computed inclusively from the date range.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="emp">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger id="emp"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {(employees?.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lt">Leave type</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger id="lt"><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {(types ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="sd">Start</Label><Input id="sd" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="ed">End</Label><Input id="ed" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="rs">Reason</Label><Input id="rs" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !employeeId || !leaveTypeId || !startDate || !endDate}>{create.isPending ? 'Submitting…' : 'Submit'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
