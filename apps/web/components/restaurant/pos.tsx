'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Minus, Plus, Trash2, Wallet } from 'lucide-react';
import { ApiError, apiDelete, apiPost } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import {
  type MenuItem, type OrderDetail, type RestTable, Hint, ORDER_CHANNELS, PAYMENT_METHODS,
  SETTLEABLE, Spinner, StatusBadge, imageSrc,
} from '@/components/restaurant/rest-ui';
import { ReceiptDialog, ScanToAdd } from '@/components/restaurant/printing';

const err = (e: unknown) => (e instanceof ApiError ? e.message : '');

// ── Cart / ticket (list pane) ──────────────────────────────────────────────────
export function PosCart({ order, orderId, setOrderId, tables, loading, branchId }: {
  order?: OrderDetail; orderId: string | null; setOrderId: (id: string | null) => void;
  tables: RestTable[]; loading: boolean; branchId?: string | null;
}) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['rest-pos-order', orderId] });
    qc.invalidateQueries({ queryKey: ['rest-orders'] });
    qc.invalidateQueries({ queryKey: ['rest-kds'] });
    qc.invalidateQueries({ queryKey: ['rest-tables'] });
  };

  const act = useMutation({
    mutationFn: (v: { run: () => Promise<unknown>; ok: string }) => v.run(),
    onSuccess: (_d, v) => { toast.success(v.ok); invalidate(); },
    onError: (e) => toast.error('Action failed', { description: err(e) }),
  });

  if (!orderId || !order) {
    return <StartOrder tables={tables} onStarted={setOrderId} branchId={branchId} />;
  }

  const settled = ['SETTLED', 'CLOSED'].includes(order.status);
  const canEdit = ['DRAFT', 'PLACED'].includes(order.status);
  const post = (path: string, ok: string, body?: unknown) => act.mutate({ run: () => apiPost(`/restaurant/orders/${orderId}/${path}`, body), ok });
  const removeLine = (lineId: string) => act.mutate({ run: () => apiDelete(`/restaurant/orders/${orderId}/items/${lineId}`), ok: 'Item removed' });
  const t = order.totals;

  return (
    <>
      <PaneHeader>
        <span className="flex-1 truncate text-sm font-semibold">{order.orderNo}</span>
        <StatusBadge status={order.status} />
        <Button size="sm" variant="ghost" className="h-7" onClick={() => setOrderId(null)}>New</Button>
      </PaneHeader>
      <PaneBody className="flex flex-col">
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          {order.channel.replace(/_/g, ' ').toLowerCase()}{order.table ? ` · ${order.table}` : ''} · {order.guestCount} guest{order.guestCount === 1 ? '' : 's'}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {order.items.length === 0 ? <Hint>Tap dishes on the right to build the ticket.</Hint> : (
            <ul className="divide-y">{order.items.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-4 py-2.5">
                <span className="w-7 text-center text-sm font-semibold tabular-nums text-muted-foreground">{l.qty}×</span>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{formatMoney(l.unitPrice.amountMinor, l.unitPrice.currency)}</div></div>
                <span className="text-sm font-semibold tabular-nums">{formatMoney(l.lineTotal.amountMinor, l.lineTotal.currency)}</span>
                {canEdit ? <button type="button" title="Remove" className="text-muted-foreground hover:text-rose-600" disabled={act.isPending} onClick={() => removeLine(l.id)}><Trash2 className="h-4 w-4" /></button> : null}
              </li>
            ))}</ul>
          )}
        </div>
        {canEdit ? (
          <div className="shrink-0 border-t px-4 py-2">
            <ScanToAdd orderId={orderId} />
          </div>
        ) : null}
        <div className="shrink-0 border-t bg-muted/20 px-4 py-3">
          <dl className="space-y-1 text-sm">
            <Row label="Subtotal" value={formatMoney(t.subtotal.amountMinor, t.subtotal.currency)} />
            {t.serviceCharge.amountMinor > 0 ? <Row label="Service" value={formatMoney(t.serviceCharge.amountMinor, t.serviceCharge.currency)} /> : null}
            <Row label="Tax" value={formatMoney(t.tax.amountMinor, t.tax.currency)} />
            {t.rounding.amountMinor !== 0 ? <Row label="Rounding" value={formatMoney(t.rounding.amountMinor, t.rounding.currency)} /> : null}
            <div className="flex justify-between border-t pt-1.5 text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(t.total.amountMinor, t.total.currency)}</dd></div>
            {settled ? <Row label="Paid" value={formatMoney(t.paid.amountMinor, t.paid.currency)} /> : null}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {order.status === 'DRAFT' ? <Button size="sm" className="flex-1" disabled={!order.items.length || act.isPending} onClick={() => post('place', 'Order placed')}>Place order</Button> : null}
            {order.status === 'PLACED' ? <Button size="sm" className="flex-1" disabled={act.isPending} onClick={() => post('confirm', 'Sent to kitchen')}>Send to kitchen</Button> : null}
            {SETTLEABLE.includes(order.status) ? <SettleDialog order={order} onSettled={invalidate} /> : null}
            {settled ? <Button size="sm" className="flex-1" onClick={() => setOrderId(null)}>New order</Button> : null}
            <ReceiptDialog orderId={order.id} orderNo={order.orderNo} settled={settled} />
            {!settled ? <Button size="sm" variant="destructive" disabled={act.isPending} onClick={() => post('void', 'Order voided', { reason: 'Voided from POS' })}><Ban className="size-3.5" /></Button> : null}
          </div>
        </div>
      </PaneBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-muted-foreground"><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}

/** Full-bleed card image with a warm fallback when the photo is missing/broken. */
function PosCardImage({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img src={src} alt={name} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />;
  return <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-100 to-orange-200 text-2xl font-bold text-orange-700 dark:from-amber-500/20 dark:to-orange-500/20 dark:text-orange-300">{name.trim().charAt(0).toUpperCase() || '•'}</div>;
}

// ── Start a new order ───────────────────────────────────────────────────────────
function StartOrder({ tables, onStarted, branchId }: { tables: RestTable[]; onStarted: (id: string) => void; branchId?: string | null }) {
  const [channel, setChannel] = useState<string>('DINE_IN');
  const [tableId, setTableId] = useState<string>('');
  const [guests, setGuests] = useState('2');
  const openTables = tables.filter((t) => ['AVAILABLE', 'RESERVED'].includes(t.status));

  const start = useMutation({
    mutationFn: () => apiPost<{ id: string }>('/restaurant/orders', {
      channel,
      branchId: branchId ?? undefined,
      tableId: channel === 'DINE_IN' && tableId ? tableId : undefined,
      guestCount: guests.trim() ? Number(guests) : undefined,
    }),
    onSuccess: (o) => { toast.success('Order started'); onStarted(o.id); },
    onError: (e) => toast.error('Could not start order', { description: err(e) }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); start.mutate(); }

  return (
    <>
      <PaneHeader><span className="flex-1 text-sm font-semibold">New order</span></PaneHeader>
      <PaneBody className="p-4">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ch">Channel</Label>
            <Select value={channel} onValueChange={(v) => { setChannel(v); if (v !== 'DINE_IN') setTableId(''); }}>
              <SelectTrigger id="ch"><SelectValue /></SelectTrigger>
              <SelectContent>{ORDER_CHANNELS.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {channel === 'DINE_IN' ? (
            <div className="space-y-2">
              <Label htmlFor="tb">Table</Label>
              <Select value={tableId} onValueChange={setTableId}>
                <SelectTrigger id="tb"><SelectValue placeholder="Pick a free table" /></SelectTrigger>
                <SelectContent>{openTables.length ? openTables.map((t) => <SelectItem key={t.id} value={t.id}>{t.code} · seats {t.capacity}</SelectItem>) : <div className="px-2 py-1.5 text-xs text-muted-foreground">No free tables</div>}</SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2"><Label htmlFor="gc">Guests</Label><Input id="gc" type="number" min="1" value={guests} onChange={(e) => setGuests(e.target.value)} /></div>
          <Button type="submit" className="w-full" disabled={start.isPending}>{start.isPending ? 'Starting…' : 'Start order'}</Button>
          <p className="text-center text-xs text-muted-foreground">Then tap dishes on the right to build the ticket.</p>
        </form>
      </PaneBody>
    </>
  );
}

// ── Menu grid (detail pane) — tap to add ────────────────────────────────────────
export function PosMenu({ items, orderId, canAdd, loading }: { items: MenuItem[]; orderId: string | null; canAdd: boolean; loading: boolean }) {
  const qc = useQueryClient();
  const [cat, setCat] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (itemId: string) => apiPost(`/restaurant/orders/${orderId}/items`, { items: [{ itemId, qty: 1 }] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rest-pos-order', orderId] });
      qc.invalidateQueries({ queryKey: ['rest-orders'] });
    },
    onError: (e) => toast.error('Could not add', { description: err(e) }),
  });

  const cats = [...new Set(items.map((i) => i.category ?? 'Other'))];
  const shown = items.filter((i) => i.available && (!cat || (i.category ?? 'Other') === cat));

  return (
    <>
      <PaneHeader>
        <span className="text-sm font-semibold">Menu</span>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-1">
          <button type="button" onClick={() => setCat(null)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${!cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>All</button>
          {cats.map((c) => <button key={c} type="button" onClick={() => setCat(c)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${cat === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{c}</button>)}
        </div>
      </PaneHeader>
      <PaneBody className="p-4">
        {!canAdd ? <Hint>Start an order on the left, then tap dishes to add them.</Hint>
          : loading ? <Spinner />
          : shown.length === 0 ? <Hint>No available items in this category.</Hint>
          : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  disabled={add.isPending}
                  onClick={() => add.mutate(i.id)}
                  className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition hover:border-primary/50 hover:shadow-md active:scale-[0.98] disabled:opacity-60"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                    <PosCardImage src={imageSrc(i.imageKey)} name={i.name} />
                    <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow transition group-hover:opacity-100"><Plus className="h-4 w-4" /></span>
                  </div>
                  <div className="flex flex-1 flex-col p-2.5">
                    <span className="line-clamp-2 text-sm font-medium leading-tight">{i.name}</span>
                    <span className="mt-1 text-sm font-bold tabular-nums text-primary">{formatMoney(i.effectivePrice.amountMinor, i.effectivePrice.currency)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
      </PaneBody>
    </>
  );
}

// ── Settle dialog ───────────────────────────────────────────────────────────────
function SettleDialog({ order, onSettled }: { order: OrderDetail; onSettled: () => void }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<string>('CASH');
  const totalMajor = (order.totals.total.amountMinor / 100).toFixed(2);
  const [amount, setAmount] = useState(totalMajor);
  const amountMinor = Math.round(Number(amount || '0') * 100);
  const changeMinor = amountMinor - order.totals.total.amountMinor;

  const settle = useMutation({
    mutationFn: () => apiPost(`/restaurant/orders/${order.id}/settle`, { payments: [{ method, amountMinor }] }),
    onSuccess: () => { toast.success('Bill settled', { description: order.orderNo }); onSettled(); setOpen(false); },
    onError: (e) => toast.error('Settle failed', { description: err(e) }),
  });

  return (
    <>
      <Button size="sm" className="flex-1" onClick={() => { setAmount(totalMajor); setOpen(true); }}><Wallet className="size-3.5" /> Settle</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settle {order.orderNo}</DialogTitle>
            <DialogDescription>Total due {formatMoney(order.totals.total.amountMinor, order.totals.total.currency)}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); settle.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Payment method</Label>
              <div className="grid grid-cols-4 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)} className={`rounded-lg border py-2 text-xs font-medium ${method === m ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}>{m}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amt">Amount tendered</Label>
              <Input id="amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {changeMinor > 0 ? <p className="text-xs text-emerald-600">Change: {formatMoney(changeMinor, order.totals.total.currency)}</p> : changeMinor < 0 ? <p className="text-xs text-amber-600">Short by {formatMoney(-changeMinor, order.totals.total.currency)}</p> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={amountMinor < order.totals.total.amountMinor || settle.isPending}>{settle.isPending ? 'Settling…' : 'Take payment'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
