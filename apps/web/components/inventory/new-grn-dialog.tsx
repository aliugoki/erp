'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Product } from '@/lib/types';
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
import { LineItemsEditor, toItems, type DocLine } from './line-items-editor';

export function NewGrnDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ receivedOn: '', notes: '' });
  const [lines, setLines] = useState<DocLine[]>([]);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products') });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/inventory/grns', {
        receivedOn: f.receivedOn ? new Date(f.receivedOn).toISOString() : undefined,
        notes: f.notes || undefined,
        items: toItems(lines),
      }),
    onSuccess: () => {
      toast.success('Goods receipt created');
      qc.invalidateQueries({ queryKey: ['grns'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      setOpen(false);
      setF({ receivedOn: '', notes: '' });
      setLines([]);
    },
    onError: (e) => toast.error('Could not create goods receipt', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (toItems(lines).length < 1) { toast.error('Add at least one item'); return; }
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> New GRN
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New goods receipt</DialogTitle>
          <DialogDescription>Receive stock directly into inventory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ro">Received on</Label>
            <Input id="ro" type="date" value={f.receivedOn} onChange={(e) => set('receivedOn')(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea id="notes" value={f.notes} onChange={(e) => set('notes')(e.target.value)} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-2">
            <Label>Items</Label>
            <LineItemsEditor products={products ?? []} lines={lines} onChange={setLines} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create GRN'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
