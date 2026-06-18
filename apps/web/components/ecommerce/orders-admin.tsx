'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageOpen } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { EcOrder } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/utils';

const STATUSES = ['PENDING', 'PAID', 'FULFILLED', 'SHIPPED', 'CANCELLED', 'REFUNDED'];
const tone: Record<string, string> = {
  PENDING: 'secondary', PAID: 'default', FULFILLED: 'default', SHIPPED: 'default', CANCELLED: 'destructive', REFUNDED: 'destructive',
};

export function OrdersAdmin() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['ec-orders', filter],
    queryFn: () => apiGet<EcOrder[]>(`/ecommerce/orders${filter ? `?status=${filter}` : ''}`),
  });
  const detail = useQuery({
    queryKey: ['ec-order', openId],
    queryFn: () => apiGet<EcOrder>(`/ecommerce/orders/${openId}`),
    enabled: !!openId,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/ecommerce/orders/${id}/status`, { status }),
    onSuccess: () => { toast.success('Order updated'); void qc.invalidateQueries({ queryKey: ['ec-orders'] }); void qc.invalidateQueries({ queryKey: ['ec-order', openId] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed'),
  });

  const o = detail.data;
  const release = useMutation({
    mutationFn: () => apiPost<{ released: number }>('/ecommerce/orders/release-expired', {}),
    onSuccess: (r) => { toast.success(r.released ? `Released ${r.released} expired hold(s)` : 'No expired holds to release'); void qc.invalidateQueries({ queryKey: ['ec-orders'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={release.isPending} onClick={() => release.mutate()} title="Cancel + restock unpaid card orders past their payment window (also runs automatically)">
          {release.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Release expired holds
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Payment</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y">
            {list.isLoading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : (list.data ?? []).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground"><PackageOpen className="mx-auto mb-2 h-6 w-6" />No orders yet.</td></tr>
            ) : (
              list.data!.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setOpenId(r.id)}>
                  <td className="px-4 py-2 font-medium">{r.orderNo}</td>
                  <td className="px-4 py-2"><div>{r.customerName}</div><div className="text-xs text-muted-foreground">{r.customerEmail}</div></td>
                  <td className="px-4 py-2"><Badge variant={r.paymentStatus === 'PAID' ? 'default' : 'secondary'} className="text-[10px]">{r.paymentMethod} · {r.paymentStatus}</Badge></td>
                  <td className="px-4 py-2"><Badge variant={(tone[r.status] ?? 'outline') as 'default' | 'secondary' | 'destructive' | 'outline'} className="text-[10px]">{r.status}</Badge></td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(r.total.amountMinor, r.total.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!openId} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{o ? `Order ${o.orderNo}` : 'Order'}</DialogTitle></DialogHeader>
          {!o ? <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Info label="Customer" value={o.customerName} />
                <Info label="Email" value={o.customerEmail} />
                {o.customerPhone ? <Info label="Phone" value={o.customerPhone} /> : null}
                {o.shippingAddress ? <Info label="Ship to" value={[o.shippingAddress, o.shippingCity, o.shippingCountry].filter(Boolean).join(', ')} /> : null}
              </div>
              <div className="rounded-lg border divide-y">
                {(o.lines ?? []).map((l) => (
                  <div key={l.id} className="flex justify-between px-3 py-2 text-sm">
                    <span>{l.quantity}× {l.title}</span>
                    <span className="tabular-nums">{formatMoney(l.lineTotal.amountMinor, o.total.currency)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2 text-sm font-semibold">
                  <span>Total</span><span className="tabular-nums">{formatMoney(o.total.amountMinor, o.total.currency)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Set status:</span>
                {STATUSES.map((s) => (
                  <Button key={s} size="sm" variant={o.status === s ? 'default' : 'outline'} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: o.id, status: s })}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div>{value}</div></div>;
}
