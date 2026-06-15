'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Product, PurchaseOrder, Vendor } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS: Record<PurchaseOrder['status'], 'secondary' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'secondary', APPROVED: 'warning', PARTIAL: 'warning', RECEIVED: 'success', CLOSED: 'secondary', CANCELLED: 'destructive',
};

export default function PurchaseOrdersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders'], queryFn: () => apiGet<PurchaseOrder[]>('/inventory/purchase-orders') });
  const rows = data ?? [];
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); qc.invalidateQueries({ queryKey: ['products'] }); };

  const approve = useMutation({
    mutationFn: (id: string) => apiPost(`/inventory/purchase-orders/${id}/approve`),
    onSuccess: () => { toast.success('PO approved'); invalidate(); },
    onError: (e) => toast.error('Action failed', { description: e instanceof ApiError ? e.message : '' }),
  });
  const receive = useMutation({
    mutationFn: (id: string) => apiPost<{ grnNo?: string }>('/inventory/grns', { poId: id }),
    onSuccess: (r: { grnNo?: string }) => { toast.success(`Received (${r.grnNo})`); invalidate(); },
    onError: (e) => toast.error('Receive failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Inventory" description="Purchase orders & goods receipt." action={<NewPoDialog />} />
      <InventoryTabs />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO #</TableHead><TableHead>Vendor</TableHead><TableHead className="text-right">Total</TableHead>
              <TableHead>Received</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.po_no}</TableCell>
                <TableCell>{p.vendor ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(p.total_minor, p.currency)}</TableCell>
                <TableCell className="tabular-nums">{p.received_qty}/{p.ordered_qty}</TableCell>
                <TableCell><Badge variant={STATUS[p.status]}>{p.status}</Badge></TableCell>
                <TableCell className="text-right space-x-2">
                  {p.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => approve.mutate(p.id)}>Approve</Button>}
                  {(p.status === 'APPROVED' || p.status === 'PARTIAL') && <Button size="sm" onClick={() => receive.mutate(p.id)}>Receive (GRN)</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!isLoading && rows.length === 0 ? <div className="p-4"><EmptyState icon={ShoppingCart} title="No purchase orders" description="Raise a PO to procure stock." action={<NewPoDialog />} /></div> : null}
      </Card>
    </div>
  );
}

function NewPoDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('NONE');
  const [lines, setLines] = useState<{ productId: string; qty: string; price: string }[]>([{ productId: '', qty: '1', price: '' }]);
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products'), enabled: open });
  const { data: vendors } = useQuery({ queryKey: ['vendors'], queryFn: () => apiGet<Vendor[]>('/finance/vendors'), enabled: open });

  const create = useMutation({
    mutationFn: () => apiPost('/inventory/purchase-orders', {
      ...(vendorId !== 'NONE' ? { vendorId } : {}),
      items: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, qty: Number(l.qty), unitPriceMinor: Math.round(Number(l.price || 0) * 100) })),
    }),
    onSuccess: () => {
      toast.success('Purchase order created');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setOpen(false); setVendorId('NONE'); setLines([{ productId: '', qty: '1', price: '' }]);
    },
    onError: (e) => toast.error('Could not create', { description: e instanceof ApiError ? e.message : '' }),
  });
  const valid = lines.some((l) => l.productId && Number(l.qty) > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> New PO</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New purchase order</DialogTitle><DialogDescription>Order stock from a vendor; receive it later with a GRN.</DialogDescription></DialogHeader>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label>Vendor <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="No vendor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">— No vendor —</SelectItem>
                {(vendors ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Items</Label>
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Select value={l.productId} onValueChange={(v) => setLines((s) => s.map((x, j) => j === i ? { ...x, productId: v } : x))}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Product" /></SelectTrigger>
                  <SelectContent>{(products ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} · {p.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="w-20" type="number" min="1" value={l.qty} onChange={(e) => setLines((s) => s.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} placeholder="Qty" />
                <Input className="w-24" type="number" min="0" step="0.01" value={l.price} onChange={(e) => setLines((s) => s.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="Unit" />
                {lines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((s) => [...s, { productId: '', qty: '1', price: '' }])}><Plus className="size-4" /> Add line</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? 'Saving…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
