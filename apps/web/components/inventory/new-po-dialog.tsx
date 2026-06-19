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

interface Vendor { id: string; name: string }

export function NewPoDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ vendorId: '', currency: 'PKR', expectedOn: '', notes: '' });
  const [lines, setLines] = useState<DocLine[]>([]);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products') });
  const { data: vendors } = useQuery({ queryKey: ['vendors'], queryFn: () => apiGet<Vendor[]>('/finance/vendors') });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/inventory/purchase-orders', {
        vendorId: f.vendorId || undefined,
        currency: f.currency || 'PKR',
        expectedOn: f.expectedOn ? new Date(f.expectedOn).toISOString() : undefined,
        notes: f.notes || undefined,
        items: toItems(lines, true),
      }),
    onSuccess: () => {
      toast.success('Purchase order created');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setOpen(false);
      setF({ vendorId: '', currency: 'PKR', expectedOn: '', notes: '' });
      setLines([]);
    },
    onError: (e) => toast.error('Could not create purchase order', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (toItems(lines, true).length < 1) { toast.error('Add at least one item'); return; }
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> New purchase order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>Order stock from a vendor and receive it via a GRN.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor</Label>
              <select id="vendor" value={f.vendorId} onChange={(e) => set('vendorId')(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">No vendor</option>
                {(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cur">Currency</Label>
              <Input id="cur" value={f.currency} onChange={(e) => set('currency')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="exp">Expected on</Label>
            <Input id="exp" type="date" value={f.expectedOn} onChange={(e) => set('expectedOn')(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea id="notes" value={f.notes} onChange={(e) => set('notes')(e.target.value)} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-2">
            <Label>Items</Label>
            <LineItemsEditor products={products ?? []} lines={lines} onChange={setLines} withPrice />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create purchase order'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
