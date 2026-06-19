'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, PackageCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { DocStatusBadge, fmtDate } from './inv-ui';

interface Money { amountMinor: number; currency: string }
interface PoItem { id: string; productId: string; sku: string; name: string; qty: number; receivedQty: number; unitPrice: Money }
interface PurchaseOrder { id: string; poNo: string; status: string; currency: string; expectedOn: string | null; notes: string | null; vendor: string | null; total: Money; items: PoItem[] }

/** Purchase-order detail + lifecycle actions, sized to live inside the three-pane detail column. */
export function PoDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const po = useQuery({ queryKey: ['po', id], queryFn: () => apiGet<PurchaseOrder>(`/inventory/purchase-orders/${id}`) });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    void qc.invalidateQueries({ queryKey: ['po', id] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const approve = useMutation({ mutationFn: () => apiPost(`/inventory/purchase-orders/${id}/approve`, {}), onSuccess: () => { toast.success('Approved'); invalidate(); }, onError: onErr });
  const cancel = useMutation({ mutationFn: () => apiPost(`/inventory/purchase-orders/${id}/cancel`, {}), onSuccess: () => { toast.success('Cancelled'); invalidate(); }, onError: onErr });
  const receive = useMutation({
    mutationFn: () => apiPost('/inventory/grns', { poId: id }),
    onSuccess: () => {
      toast.success('Goods received');
      invalidate();
      void qc.invalidateQueries({ queryKey: ['grns'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: onErr,
  });

  if (po.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (po.isError || !po.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Purchase order not found.</div>;
  const p = po.data;
  const canCancel = p.status === 'DRAFT' || p.status === 'APPROVED' || p.status === 'PARTIAL';
  const canReceive = p.status === 'APPROVED' || p.status === 'PARTIAL';

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{p.poNo}</span><DocStatusBadge status={p.status} /></div>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(p.total.amountMinor, p.total.currency)}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {p.status === 'DRAFT' ? <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending}><Check className="mr-1.5 h-4 w-4" /> Approve</Button> : null}
          {canReceive ? <Button size="sm" onClick={() => receive.mutate()} disabled={receive.isPending}><PackageCheck className="mr-1.5 h-4 w-4" /> Receive (GRN)</Button> : null}
          {canCancel ? <Button variant="outline" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}><X className="mr-1.5 h-4 w-4" /> Cancel</Button> : null}
        </div>
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Vendor" value={p.vendor ?? '—'} />
          <Tile label="Expected" value={fmtDate(p.expectedOn)} />
          <Tile label="Notes" value={p.notes ?? '—'} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Unit price</th></tr>
              </thead>
              <tbody className="divide-y">
                {p.items.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No items.</td></tr>
                ) : p.items.map((it) => (
                  <tr key={it.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5"><div className="font-medium">{it.name}</div><div className="text-xs text-muted-foreground">{it.sku}</div></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{it.qty}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{it.receivedQty}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(it.unitPrice.amountMinor, it.unitPrice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PaneBody>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}
