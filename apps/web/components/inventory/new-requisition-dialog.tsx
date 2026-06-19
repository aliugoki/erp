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

export function NewRequisitionDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ requestedBy: '', department: '', neededBy: '', notes: '' });
  const [lines, setLines] = useState<DocLine[]>([]);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products') });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/inventory/requisitions', {
        requestedBy: f.requestedBy || undefined,
        department: f.department || undefined,
        neededBy: f.neededBy ? new Date(f.neededBy).toISOString() : undefined,
        notes: f.notes || undefined,
        items: toItems(lines),
      }),
    onSuccess: () => {
      toast.success('Requisition created');
      qc.invalidateQueries({ queryKey: ['requisitions'] });
      setOpen(false);
      setF({ requestedBy: '', department: '', neededBy: '', notes: '' });
      setLines([]);
    },
    onError: (e) => toast.error('Could not create requisition', { description: e instanceof ApiError ? e.message : '' }),
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
          <Plus className="mr-2 h-4 w-4" /> New requisition
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New requisition</DialogTitle>
          <DialogDescription>Request stock to be issued from inventory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rb">Requested by</Label>
              <Input id="rb" value={f.requestedBy} onChange={(e) => set('requestedBy')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dep">Department</Label>
              <Input id="dep" value={f.department} onChange={(e) => set('department')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nb">Needed by</Label>
            <Input id="nb" type="date" value={f.neededBy} onChange={(e) => set('neededBy')(e.target.value)} />
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
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create requisition'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
