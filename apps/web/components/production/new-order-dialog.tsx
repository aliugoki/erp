'use client';
import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Bom, ProductionAttribute, Product } from '@/lib/types';
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
import { Switch } from '@/components/ui/switch';

export function NewOrderDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [bomId, setBomId] = useState('');
  const [plannedQty, setPlannedQty] = useState('1');
  const [priority, setPriority] = useState('NORMAL');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});

  const products = useQuery({ queryKey: ['pos-products'], queryFn: () => apiGet<Product[]>('/inventory/products'), enabled: open });
  const boms = useQuery({ queryKey: ['prod-boms'], queryFn: () => apiGet<Bom[]>('/production/boms'), enabled: open });
  const attributes = useQuery({ queryKey: ['prod-attributes'], queryFn: () => apiGet<ProductionAttribute[]>('/production/attributes'), enabled: open });

  const bomsForProduct = useMemo(
    () => (boms.data ?? []).filter((b) => b.productId === productId && b.status !== 'ARCHIVED'),
    [boms.data, productId],
  );

  const reset = () => { setProductId(''); setBomId(''); setPlannedQty('1'); setPriority('NORMAL'); setPlannedEnd(''); setAttrValues({}); };

  const create = useMutation({
    mutationFn: () =>
      apiPost('/production/orders', {
        productId,
        ...(bomId ? { bomId } : {}),
        plannedQty: Number(plannedQty) || 1,
        priority,
        ...(plannedEnd ? { plannedEnd } : {}),
        attributes: Object.entries(attrValues)
          .filter(([, v]) => v !== '')
          .map(([attributeId, value]) => ({ attributeId, value })),
      }),
    onSuccess: () => {
      toast.success('Production order created');
      qc.invalidateQueries({ queryKey: ['prod-orders'] });
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error('Could not create order', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!productId) return toast.error('Pick a product to manufacture');
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New order</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New production order</DialogTitle>
          <DialogDescription>Pick a finished product and a BOM; materials are scaled to the planned quantity.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Product to manufacture</Label>
            <Select value={productId} onValueChange={(v) => { setProductId(v); setBomId(''); }}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {(products.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>BOM</Label>
              <Select value={bomId || 'none'} onValueChange={(v) => setBomId(v === 'none' ? '' : v)} disabled={!productId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No BOM (ad-hoc)</SelectItem>
                  {bomsForProduct.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} · {b.bomNo}{b.status === 'ACTIVE' ? ' ✓' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pq">Planned quantity</Label>
              <Input id="pq" type="number" min="1" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pe">Due date</Label>
              <Input id="pe" type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
            </div>
          </div>

          {(attributes.data ?? []).length > 0 ? (
            <div className="space-y-3 border-t pt-3">
              <p className="text-sm font-medium text-muted-foreground">Custom attributes</p>
              {(attributes.data ?? []).map((a) => (
                <AttrField key={a.id} attr={a} value={attrValues[a.id] ?? ''} onChange={(v) => setAttrValues((s) => ({ ...s, [a.id]: v }))} />
              ))}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create order'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttrField({ attr, value, onChange }: { attr: ProductionAttribute; value: string; onChange: (v: string) => void }) {
  if (attr.dataType === 'BOOLEAN') {
    return (
      <div className="flex items-center justify-between">
        <Label>{attr.label}{attr.required ? ' *' : ''}</Label>
        <Switch checked={value === 'true'} onCheckedChange={(v) => onChange(v ? 'true' : 'false')} />
      </div>
    );
  }
  if (attr.dataType === 'SELECT') {
    const opts = (attr.options ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    return (
      <div className="space-y-1.5">
        <Label>{attr.label}{attr.required ? ' *' : ''}</Label>
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    );
  }
  const type = attr.dataType === 'NUMBER' ? 'number' : attr.dataType === 'DATE' ? 'date' : 'text';
  return (
    <div className="space-y-1.5">
      <Label>{attr.label}{attr.required ? ' *' : ''}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
