'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY = { name: '', code: '', daysPerYear: '0' };

export function NewLeaveTypeDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: () => apiPost('/hr/leave-types', { name: f.name, code: f.code || undefined, daysPerYear: Number(f.daysPerYear) || 0 }),
    onSuccess: () => {
      toast.success('Leave type added', { description: f.name });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      setOpen(false);
      setF(EMPTY);
    },
    onError: (e) => toast.error('Could not add leave type', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="size-4" /> Leave type</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New leave type</DialogTitle>
          <DialogDescription>e.g. Annual, Sick, Casual — with an annual entitlement.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="ln">Name</Label><Input id="ln" value={f.name} onChange={(e) => set('name')(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="lc">Code</Label><Input id="lc" value={f.code} onChange={(e) => set('code')(e.target.value)} placeholder="ANNUAL" /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="ld">Days per year</Label><Input id="ld" type="number" min="0" value={f.daysPerYear} onChange={(e) => set('daysPerYear')(e.target.value)} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !f.name.trim()}>{create.isPending ? 'Adding…' : 'Add type'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
