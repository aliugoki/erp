'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
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

const METHODS = [
  { v: 'STRAIGHT_LINE', l: 'Straight line' },
  { v: 'DECLINING_BALANCE', l: 'Declining balance' },
  { v: 'NONE', l: 'No depreciation' },
];

export function NewCategoryDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', method: 'STRAIGHT_LINE', usefulLifeMonths: '60', salvagePct: '0' });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/assets/categories', {
        name: form.name,
        ...(form.code ? { code: form.code } : {}),
        method: form.method,
        usefulLifeMonths: Number(form.usefulLifeMonths) || 60,
        salvagePct: Number(form.salvagePct) || 0,
      }),
    onSuccess: () => {
      toast.success('Category created');
      qc.invalidateQueries({ queryKey: ['asset-categories'] });
      setOpen(false);
      setForm({ name: '', code: '', method: 'STRAIGHT_LINE', usefulLifeMonths: '60', salvagePct: '0' });
    },
    onError: (e) => toast.error('Could not create', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Plus className="mr-1 h-4 w-4" /> Category</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New asset category</DialogTitle>
          <DialogDescription>Defaults the depreciation policy for its assets.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cn">Name</Label>
              <Input id="cn" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Machinery" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cc">Code</Label>
              <Input id="cc" value={form.code} onChange={(e) => set('code')(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Depreciation method</Label>
            <Select value={form.method} onValueChange={set('method')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ul">Useful life (months)</Label>
              <Input id="ul" type="number" min="1" value={form.usefulLifeMonths} onChange={(e) => set('usefulLifeMonths')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sp">Salvage %</Label>
              <Input id="sp" type="number" min="0" max="100" value={form.salvagePct} onChange={(e) => set('salvagePct')(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
