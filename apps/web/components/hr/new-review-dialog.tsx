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

export function NewReviewDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [period, setPeriod] = useState('');
  const [rating, setRating] = useState('');
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');

  const { data: employees } = useQuery({ queryKey: ['employees-all'], queryFn: () => apiList<Employee>('/hr/employees?pageSize=100') });

  const create = useMutation({
    mutationFn: () => apiPost('/hr/reviews', {
      employeeId, period, rating: rating ? Number(rating) : undefined,
      strengths: strengths || undefined, improvements: improvements || undefined,
    }),
    onSuccess: () => {
      toast.success('Review created');
      qc.invalidateQueries({ queryKey: ['reviews'] });
      setOpen(false);
      setEmployeeId(''); setPeriod(''); setRating(''); setStrengths(''); setImprovements('');
    },
    onError: (e) => toast.error('Could not create review', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> New review</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New performance review</DialogTitle>
          <DialogDescription>Rate 1–5 and capture strengths and areas to improve.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="re">Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger id="re"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{(employees?.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rt">Rating</Label>
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger id="rt"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2"><Label htmlFor="rp">Period</Label><Input id="rp" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="H1 2026" required /></div>
          <div className="space-y-2"><Label htmlFor="rs">Strengths</Label><Input id="rs" value={strengths} onChange={(e) => setStrengths(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="ri">Improvements</Label><Input id="ri" value={improvements} onChange={(e) => setImprovements(e.target.value)} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !employeeId || !period.trim()}>{create.isPending ? 'Creating…' : 'Create review'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
