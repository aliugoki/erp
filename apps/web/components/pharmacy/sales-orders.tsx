'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Trash2, Check, Truck } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { formatMoney } from '@/lib/utils';
import { type DrugListItem, Hint, Spinner, fmtDate } from '@/components/pharmacy/pharm-ui';

interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  currency: string;
  total_minor: number;
  expected_on: string | null;
  customer: string | null;
  item_count: number;
}

interface OrderDetail {
  id: string;
  orderNo: string;
  status: string;
  currency: string;
  expectedOn: string | null;
  notes: string | null;
  customer: string | null;
  total: { amountMinor: number; currency: string };
  items: Array<{
    id: string;
    productId: string;
    sku: string;
    name: string;
    qty: number;
    fulfilledQty: number;
    unitPrice: { amountMinor: number; currency: string };
  }>;
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  CONFIRMED: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  PARTIAL: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  FULFILLED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  CANCELLED: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
};

function OrderStatus({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

interface ItemRow {
  productId: string;
  qty: string;
  unitPriceMajor: string;
}

const EMPTY_ROW: ItemRow = { productId: '', qty: '1', unitPriceMajor: '' };

/** Wholesale B2B sales orders — list, create, and the per-order lifecycle (confirm/fulfil/cancel). */
export function SalesOrders() {
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const orders = useQuery({ queryKey: ['pharm-orders'], queryFn: () => apiGet<OrderRow[]>('/pharmacy/sales-orders') });

  return (
    <>
      <PaneHeader>
        <span className="flex-1 text-sm font-medium">Sales orders</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New order
        </Button>
      </PaneHeader>
      <PaneBody>
        {orders.isLoading ? (
          <Spinner />
        ) : (orders.data ?? []).length === 0 ? (
          <Hint>No sales orders yet. Create one to sell wholesale to a B2B customer.</Hint>
        ) : (
          <ul className="divide-y">
            {(orders.data ?? []).map((o) => (
              <li
                key={o.id}
                className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-muted/50"
                onClick={() => setDetailId(o.id)}
              >
                <div className="min-w-0">
                  <div className="font-medium">{o.order_no}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {o.customer ?? '—'} · {o.item_count} item(s) · {fmtDate(o.expected_on)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold tabular-nums">{formatMoney(o.total_minor, o.currency)}</span>
                  <OrderStatus status={o.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </PaneBody>

      <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} />
      {detailId && <OrderDetailDialog id={detailId} onClose={() => setDetailId(null)} />}
    </>
  );
}

function CreateOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [currency, setCurrency] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);

  const drugs = useQuery({ queryKey: ['pharm-drugs'], queryFn: () => apiGet<DrugListItem[]>('/pharmacy/drugs') });

  const reset = () => {
    setCurrency('');
    setExpectedOn('');
    setNotes('');
    setRows([{ ...EMPTY_ROW }]);
  };

  const setRow = (i: number, patch: Partial<ItemRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { ...EMPTY_ROW }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));

  const valid = rows.every((r) => r.productId !== '' && Number(r.qty) >= 1);

  const create = useMutation({
    mutationFn: () =>
      apiPost('/pharmacy/sales-orders', {
        currency: currency || undefined,
        expectedOn: expectedOn || undefined,
        notes: notes || undefined,
        items: rows.map((r) => {
          const major = Number(r.unitPriceMajor);
          const hasPrice = r.unitPriceMajor.trim() !== '' && Number.isFinite(major);
          return {
            productId: r.productId,
            qty: Number(r.qty),
            ...(hasPrice ? { unitPriceMinor: Math.round(major * 100) } : {}),
          };
        }),
      }),
    onSuccess: () => {
      toast.success('Sales order created');
      qc.invalidateQueries({ queryKey: ['pharm-orders'] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error('Could not create order', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New sales order</DialogTitle>
          <DialogDescription>Wholesale B2B order. Leave price blank to use the drug&apos;s quantity-break tier.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="so-currency">Currency (optional)</Label>
              <Input id="so-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="PKR" maxLength={3} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="so-expected">Expected on</Label>
              <Input id="so-expected" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="so-notes">Notes</Label>
            <Input id="so-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>

          <div className="space-y-2">
            <Label>Items</Label>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={r.productId} onValueChange={(v) => setRow(i, { productId: v })}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select drug" />
                    </SelectTrigger>
                    <SelectContent>
                      {(drugs.data ?? []).map((d) => (
                        <SelectItem key={d.productId} value={d.productId}>
                          {d.name}
                          {d.strength ? ` ${d.strength}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={r.qty}
                    onChange={(e) => setRow(i, { qty: e.target.value })}
                    placeholder="qty"
                    className="h-9 w-20"
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={r.unitPriceMajor}
                    onChange={(e) => setRow(i, { unitPriceMajor: e.target.value })}
                    placeholder="price"
                    className="h-9 w-28"
                  />
                  <Button type="button" size="icon" variant="ghost" disabled={rows.length === 1} onClick={() => removeRow(i)}>
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addRow}>
              <Plus className="mr-2 h-4 w-4" /> Add item
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrderDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['pharm-order', id], queryFn: () => apiGet<OrderDetail>(`/pharmacy/sales-orders/${id}`) });

  const act = (path: string, label: string, fulfil = false) =>
    apiPost(`/pharmacy/sales-orders/${id}${path}`, {})
      .then(() => {
        toast.success(`${label} done`);
        const keys = fulfil
          ? ['pharm-orders', 'pharm-dispenses', 'pharm-lots', 'pharm-drugs']
          : ['pharm-orders'];
        for (const k of keys) qc.invalidateQueries({ queryKey: [k] });
        onClose();
      })
      .catch((e) => toast.error(`${label} failed`, { description: e instanceof ApiError ? e.message : '' }));

  const confirm = useMutation({ mutationFn: () => act('/confirm', 'Confirm') });
  const fulfil = useMutation({ mutationFn: () => act('/fulfill', 'Fulfil', true) });
  const cancel = useMutation({ mutationFn: () => act('/cancel', 'Cancel') });
  const busy = confirm.isPending || fulfil.isPending || cancel.isPending;

  const d = detail.data;
  const status = d?.status ?? '';

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {d ? d.orderNo : 'Sales order'}
            {d ? <OrderStatus status={d.status} /> : null}
          </DialogTitle>
          <DialogDescription>{d?.customer ?? 'Wholesale order'}</DialogDescription>
        </DialogHeader>

        {detail.isLoading || !d ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Expected: </span>{fmtDate(d.expectedOn)}</div>
              <div><span className="text-muted-foreground">Currency: </span>{d.currency}</div>
              {d.notes ? <div className="col-span-2"><span className="text-muted-foreground">Notes: </span>{d.notes}</div> : null}
            </div>

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Fulfilled</th>
                    <th className="px-3 py-2 text-right font-medium">Unit price</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {d.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-muted-foreground">{it.sku}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.fulfilledQty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(it.unitPrice.amountMinor, it.unitPrice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="text-base font-semibold tabular-nums">{formatMoney(d.total.amountMinor, d.total.currency)}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          {status === 'DRAFT' && (
            <Button disabled={busy} onClick={() => confirm.mutate()}>
              {confirm.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} Confirm
            </Button>
          )}
          {(status === 'CONFIRMED' || status === 'PARTIAL') && (
            <Button disabled={busy} onClick={() => fulfil.mutate()}>
              {fulfil.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />} Fulfil
            </Button>
          )}
          {(status === 'DRAFT' || status === 'CONFIRMED' || status === 'PARTIAL') && (
            <Button variant="outline" disabled={busy} onClick={() => cancel.mutate()}>
              <Trash2 className="mr-2 h-4 w-4 text-rose-600" /> Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
