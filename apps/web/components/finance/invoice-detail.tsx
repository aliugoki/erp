'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { StatusBadge, fmtDate } from './fin-ui';
import { ReceiveInvoiceDialog } from './receive-invoice-dialog';

interface Money { amountMinor: number; currency: string }
interface InvoiceLine { description: string; quantity: number; unitPriceMinor: number }
interface InvoiceDetailData {
  id: string;
  number: string;
  customerName: string | null;
  clientId: string;
  lineItems: InvoiceLine[];
  subtotal: Money;
  tax: Money;
  total: Money;
  status: string;
  dueDate: string | null;
}

/** Invoice detail + receive-payment action, sized to live inside the three-pane detail column. */
export function InvoiceDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => apiGet<InvoiceDetailData>(`/finance/invoices/${id}`) });

  if (invoice.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (invoice.isError || !invoice.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Invoice not found.</div>;
  const inv = invoice.data;
  const lines = inv.lineItems ?? [];
  const canPay = inv.status !== 'PAID' && inv.status !== 'VOID';

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{inv.number}</span><StatusBadge status={inv.status} /></div>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(inv.total.amountMinor, inv.total.currency)}</span>
        {canPay ? <ReceiveInvoiceDialog invoice={inv as any} /> : null}
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Customer" value={inv.customerName ?? '—'} />
          <Tile label="Due" value={fmtDate(inv.dueDate)} />
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
          <TotalRow label="Subtotal" value={formatMoney(inv.subtotal.amountMinor, inv.subtotal.currency)} />
          <TotalRow label="Tax" value={formatMoney(inv.tax.amountMinor, inv.tax.currency)} />
          <TotalRow label="Total" value={formatMoney(inv.total.amountMinor, inv.total.currency)} bold />
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
