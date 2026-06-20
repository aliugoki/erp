'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { StatusBadge, fmtDate } from './fin-ui';
import { PayBillDialog } from './pay-bill-dialog';

interface Money { amountMinor: number; currency: string }
interface BillLine { description: string; quantity: number; unitPriceMinor: number }
interface BillPayment { id: string; amount: Money; paidOn: string | null; method: string | null }
interface BillDetailData {
  id: string;
  number: string;
  vendorName: string | null;
  lineItems: BillLine[];
  subtotal: Money;
  tax: Money;
  total: Money;
  paid: Money;
  outstanding: Money;
  status: string;
  billDate: string | null;
  dueDate: string | null;
  payments: BillPayment[];
}

/** Bill detail + record-payment action, sized to live inside the three-pane detail column. */
export function BillDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const bill = useQuery({ queryKey: ['bill', id], queryFn: () => apiGet<BillDetailData>(`/finance/bills/${id}`) });

  if (bill.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (bill.isError || !bill.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Bill not found.</div>;
  const b = bill.data;
  const lines = b.lineItems ?? [];
  const payments = b.payments ?? [];
  const canPay = b.status !== 'PAID' && b.status !== 'VOID';

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{b.number}</span><StatusBadge status={b.status} /></div>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(b.total.amountMinor, b.total.currency)}</span>
        {canPay ? <PayBillDialog bill={b as any} /> : null}
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Vendor" value={b.vendorName ?? '—'} />
          <Tile label="Bill date" value={fmtDate(b.billDate)} />
          <Tile label="Due" value={fmtDate(b.dueDate)} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line items</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit price</th><th className="px-3 py-2 text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y">
                {lines.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No line items.</td></tr>
                ) : lines.map((it, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-medium">{it.description}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{it.quantity}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(it.unitPriceMinor, 'PKR')}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(it.quantity * it.unitPriceMinor, 'PKR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="ml-auto max-w-xs space-y-1.5 text-sm">
          <TotalRow label="Subtotal" value={formatMoney(b.subtotal.amountMinor, b.subtotal.currency)} />
          <TotalRow label="Tax" value={formatMoney(b.tax.amountMinor, b.tax.currency)} />
          <TotalRow label="Total" value={formatMoney(b.total.amountMinor, b.total.currency)} bold />
          <TotalRow label="Paid" value={formatMoney(b.paid.amountMinor, b.paid.currency)} />
          <TotalRow label="Outstanding" value={formatMoney(b.outstanding.amountMinor, b.outstanding.currency)} bold />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments</h3>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded.</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                  <span className="font-medium tabular-nums">{formatMoney(p.amount.amountMinor, p.amount.currency)}</span>
                  <span className="text-muted-foreground">{fmtDate(p.paidOn)} · {p.method ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PaneBody>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex items-center justify-between ${bold ? 'border-t pt-1.5 font-semibold' : 'text-muted-foreground'}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}
