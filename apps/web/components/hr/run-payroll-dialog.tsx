'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = ['2024', '2025', '2026', '2027'];

export function RunPayrollDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState('2026');
  const [month, setMonth] = useState('6');

  const run = useMutation({
    mutationFn: () => apiPost('/hr/payroll/runs', { year: Number(year), month: Number(month) }),
    onSuccess: () => {
      toast.success('Payroll generated', { description: `${MONTHS[Number(month) - 1]} ${year}` });
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
      setOpen(false);
    },
    onError: (e) => toast.error('Could not run payroll', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Play className="size-4" /> Run payroll</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run payroll</DialogTitle>
          <DialogDescription>Generates a payslip for every active, salaried employee from their basic salary and the active components.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mo">Month</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger id="mo"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="yr">Year</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger id="yr"><SelectValue /></SelectTrigger>
                <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={run.isPending}>{run.isPending ? 'Running…' : 'Run payroll'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
