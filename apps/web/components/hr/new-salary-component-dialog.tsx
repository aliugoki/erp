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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EMPTY = { name: '', code: '', type: 'EARNING', calc: 'FIXED', value: '', percent: '' };

export function NewSalaryComponentDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const isPct = f.calc === 'PCT_OF_BASIC';

  const create = useMutation({
    mutationFn: () => apiPost('/hr/salary-components', {
      name: f.name, code: f.code, type: f.type, calc: f.calc,
      valueMinor: isPct ? undefined : Math.round((Number(f.value) || 0) * 100),
      percent: isPct ? Number(f.percent) || 0 : undefined,
    }),
    onSuccess: () => {
      toast.success('Component added', { description: f.name });
      qc.invalidateQueries({ queryKey: ['salary-components'] });
      setOpen(false);
      setF(EMPTY);
    },
    onError: (e) => toast.error('Could not add component', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="size-4" /> Component</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New salary component</DialogTitle>
          <DialogDescription>An earning or deduction applied to every payroll run.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="cn">Name</Label><Input id="cn" value={f.name} onChange={(e) => set('name')(e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="cc">Code</Label><Input id="cc" value={f.code} onChange={(e) => set('code')(e.target.value)} placeholder="HRA" required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ct">Type</Label>
              <Select value={f.type} onValueChange={set('type')}>
                <SelectTrigger id="ct"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="EARNING">Earning</SelectItem><SelectItem value="DEDUCTION">Deduction</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl">Calculation</Label>
              <Select value={f.calc} onValueChange={set('calc')}>
                <SelectTrigger id="cl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="FIXED">Fixed amount</SelectItem><SelectItem value="PCT_OF_BASIC">% of basic</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          {isPct ? (
            <div className="space-y-2"><Label htmlFor="cp">Percent of basic</Label><Input id="cp" type="number" min="0" max="100" value={f.percent} onChange={(e) => set('percent')(e.target.value)} /></div>
          ) : (
            <div className="space-y-2"><Label htmlFor="cv">Amount</Label><Input id="cv" type="number" min="0" step="0.01" value={f.value} onChange={(e) => set('value')(e.target.value)} /></div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !f.name.trim() || !f.code.trim()}>{create.isPending ? 'Adding…' : 'Add component'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
