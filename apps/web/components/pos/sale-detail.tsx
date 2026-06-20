'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Loader2, Receipt, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { PosRegister, PosSale } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { PosBadge, fmtDateTime } from './pos-ui';
import { ReturnDialog } from './return-dialog';
import { ReceiptDialog } from './receipt-dialog';

/** A single POS sale: header totals, line items, payments, plus receipt / refund / void actions. */
export function SaleDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const sale = useQuery({ queryKey: ['pos-sale-detail', id], queryFn: () => apiGet<PosSale>(`/pos/sales/${id}`) });
  const registers = useQuery({ queryKey: ['pos-registers'], queryFn: () => apiGet<PosRegister[]>('/pos/registers') });
  const [returnOpen, setReturnOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['pos-sales'] });
    void qc.invalidateQueries({ queryKey: ['pos-sale-detail', id] });
  };

  const voidMut = useMutation({
    mutationFn: () => apiPost(`/pos/sales/${id}/void`, {}),
    onSuccess: () => { toast.success('Sale voided'); invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  if (sale.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (sale.isError || !sale.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Sale not found.</div>;
  const s = sale.data;
  const registerName = (registers.data ?? []).find((r) => r.id === s.registerId)?.name ?? 'Register';
  const canRefund = s.type === 'SALE' && (s.status === 'COMPLETED' || s.status === 'PARTIALLY_REFUNDED');
  const canVoid = s.type === 'SALE' && s.status === 'COMPLETED';

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{s.saleNo}</span>
          <PosBadge status={s.type} />
          <PosBadge status={s.status} />
        </div>
        <span className="font-semibold tabular-nums">{formatMoney(s.total.amountMinor, s.total.currency)}</span>
        <Button variant="outline" size="sm" onClick={() => setReceiptOpen(true)}><Receipt className="mr-1.5 h-4 w-4" /> Receipt</Button>
        {canRefund ? <Button variant="outline" size="sm" onClick={() => setReturnOpen(true)}><Undo2 className="mr-1.5 h-4 w-4" /> Refund</Button> : null}
        {canVoid ? <Button variant="ghost" size="sm" disabled={voidMut.isPending} onClick={() => { if (confirm('Void this sale?')) voidMut.mutate(); }}><Ban className="mr-1.5 h-4 w-4 text-rose-600" /> Void</Button> : null}
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Customer" value={s.customerName ?? '—'} />
          <Tile label="Sold" value={fmtDateTime(s.soldAt)} />
          <Tile label="Notes" value={s.notes ?? '—'} />
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line items</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Unit price</th><th className="px-4 py-2 text-right">Disc</th><th className="px-4 py-2 text-right">Tax</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Returned</th></tr></thead>
              <tbody className="divide-y">
                {(s.lines ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No lines.</td></tr>
                ) : (
                  (s.lines ?? []).map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2">{l.description}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.unitPrice.amountMinor, l.unitPrice.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.discount.amountMinor, l.discount.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.tax.amountMinor, l.tax.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.lineTotal.amountMinor, l.lineTotal.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.returnedQty}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Method</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2">Ref</th></tr></thead>
              <tbody className="divide-y">
                {(s.payments ?? []).length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No payments.</td></tr>
                ) : (
                  (s.payments ?? []).map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2">{p.method}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.amount.amountMinor, p.amount.currency)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p.reference ?? p.cardLast4 ?? ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ml-auto w-full max-w-xs space-y-1.5 rounded-xl border p-4 text-sm">
          <Row label="Subtotal" value={formatMoney(s.subtotal.amountMinor, s.subtotal.currency)} />
          <Row label="Discount" value={formatMoney(s.discount.amountMinor, s.discount.currency)} />
          <Row label="Tax" value={formatMoney(s.tax.amountMinor, s.tax.currency)} />
          <Row label="Total" value={formatMoney(s.total.amountMinor, s.total.currency)} bold />
          <Row label="Paid" value={formatMoney(s.paid.amountMinor, s.paid.currency)} />
          <Row label="Change" value={formatMoney(s.change.amountMinor, s.change.currency)} />
        </section>
      </PaneBody>

      <ReturnDialog open={returnOpen} onOpenChange={setReturnOpen} sale={s} onDone={() => invalidate()} />
      <ReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} sale={s} registerName={registerName} />
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between gap-2 ${bold ? 'border-t pt-1.5 font-semibold' : ''}`}><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{value}</span></div>;
}
