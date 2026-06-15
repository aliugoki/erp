'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Product } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Opening balance / stock adjustment — appends a valued row to the inventory ledger. */
export function AdjustStockDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ productId: '', quantity: '', unitPrice: '', docType: 'OPENING', narration: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products'), enabled: open });

  const submit = useMutation({
    mutationFn: () =>
      apiPost('/inventory/adjustments', {
        productId: f.productId,
        quantity: Number(f.quantity),
        docType: f.docType,
        ...(Number(f.quantity) > 0 && f.unitPrice ? { unitCostMinor: Math.round(Number(f.unitPrice) * 100) } : {}),
        ...(f.narration ? { narration: f.narration } : {}),
      }),
    onSuccess: () => {
      toast.success('Stock adjusted');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock-report'] });
      setOpen(false);
      setF({ productId: '', quantity: '', unitPrice: '', docType: 'OPENING', narration: '' });
    },
    onError: (e) => toast.error('Adjustment failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); submit.mutate(); }
  const inbound = Number(f.quantity) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><SlidersHorizontal className="size-4" /> Adjust / opening</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stock adjustment</DialogTitle>
          <DialogDescription>Positive quantity receives into stock; negative removes. Posts to the valued ledger.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Product</Label>
            <Select value={f.productId} onValueChange={set('productId')}>
              <SelectTrigger><SelectValue placeholder="Select a product" /></SelectTrigger>
              <SelectContent>{(products ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} · {p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={f.docType} onValueChange={set('docType')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPENING">Opening</SelectItem>
                  <SelectItem value="ADJUST">Adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" value={f.quantity} onChange={(e) => set('quantity')(e.target.value)} placeholder="100 or -5" required />
            </div>
            <div className="space-y-2">
              <Label>Unit cost {inbound ? '' : <span className="text-xs text-muted-foreground">(n/a)</span>}</Label>
              <Input type="number" min="0" step="0.01" value={f.unitPrice} onChange={(e) => set('unitPrice')(e.target.value)} disabled={!inbound} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Narration</Label>
            <Input value={f.narration} onChange={(e) => set('narration')(e.target.value)} placeholder="Opening balance" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!f.productId || !f.quantity || submit.isPending}>{submit.isPending ? 'Saving…' : 'Post'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
