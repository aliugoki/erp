'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
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

export function NewInvoiceDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ number: '', description: '', quantity: '1', unitPrice: '', tax: '0' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const subtotal = (Number(f.quantity) || 0) * Math.round((Number(f.unitPrice) || 0) * 100);
  const total = subtotal + Math.round((Number(f.tax) || 0) * 100);

  const create = useMutation({
    mutationFn: () =>
      apiPost('/finance/invoices', {
        number: f.number,
        lineItems: [{ description: f.description, quantity: Number(f.quantity), unitPriceMinor: Math.round(Number(f.unitPrice) * 100) }],
        taxMinor: Math.round(Number(f.tax) * 100),
      }),
    onSuccess: () => {
      toast.success('Invoice created', { description: f.number });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setOpen(false);
      setF({ number: '', description: '', quantity: '1', unitPrice: '', tax: '0' });
    },
    onError: (e) => toast.error('Could not create invoice', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New invoice
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>All amounts are stored as exact integer minor units.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="num">Invoice number</Label>
            <Input id="num" value={f.number} onChange={(e) => set('number')(e.target.value)} placeholder="INV-1001" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Line item</Label>
            <Input id="desc" value={f.description} onChange={(e) => set('description')(e.target.value)} placeholder="Consulting services" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qty">Qty</Label>
              <Input id="qty" type="number" min="1" value={f.quantity} onChange={(e) => set('quantity')(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="up">Unit price</Label>
              <Input id="up" type="number" min="0" step="0.01" value={f.unitPrice} onChange={(e) => set('unitPrice')(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx">Tax</Label>
              <Input id="tx" type="number" min="0" step="0.01" value={f.tax} onChange={(e) => set('tax')(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create invoice'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
