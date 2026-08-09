'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Category } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

const NO_CATEGORY = '__none__';

export function NewProductDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ sku: '', barcode: '', name: '', minStock: '0', costPrice: '', sellPrice: '' });
  const [categoryId, setCategoryId] = useState(NO_CATEGORY);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiGet<Category[]>('/inventory/categories'),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/inventory/products', {
        sku: f.sku,
        // Blank means "no barcode yet" — one can be minted later from the product's detail pane.
        barcode: f.barcode.trim() || undefined,
        name: f.name,
        categoryId: categoryId === NO_CATEGORY ? undefined : categoryId,
        minStock: Number(f.minStock) || 0,
        costPriceMinor: Math.round((Number(f.costPrice) || 0) * 100),
        sellPriceMinor: Math.round((Number(f.sellPrice) || 0) * 100),
      }),
    onSuccess: () => {
      toast.success('Product added', { description: f.name });
      qc.invalidateQueries({ queryKey: ['products'] });
      setOpen(false);
      setF({ sku: '', barcode: '', name: '', minStock: '0', costPrice: '', sellPrice: '' });
      setCategoryId(NO_CATEGORY);
    },
    onError: (e) => toast.error('Could not add product', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New product
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
          <DialogDescription>Define a SKU and pricing. Stock starts at zero.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" value={f.sku} onChange={(e) => set('sku')(e.target.value)} placeholder="WIDGET-1" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="barcode">Barcode <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="barcode" value={f.barcode} onChange={(e) => set('barcode')(e.target.value)} placeholder="Scan or type — leave blank to generate later" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ms">Min stock</Label>
              <Input id="ms" type="number" min="0" value={f.minStock} onChange={(e) => set('minStock')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm">Name</Label>
            <Input id="nm" value={f.name} onChange={(e) => set('name')(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="cat">
                <SelectValue placeholder="No category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {' '.repeat((c.level - 1) * 2)}
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cp">Cost price (PKR)</Label>
              <Input id="cp" type="number" min="0" step="0.01" value={f.costPrice} onChange={(e) => set('costPrice')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sp">Sell price (PKR)</Label>
              <Input id="sp" type="number" min="0" step="0.01" value={f.sellPrice} onChange={(e) => set('sellPrice')(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add product'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
