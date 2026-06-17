'use client';
import { Printer } from 'lucide-react';
import type { PosSale } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Post-sale receipt — a monospace ticket the cashier can print (browser print) or read back. */
export function ReceiptDialog({
  open,
  onOpenChange,
  sale,
  registerName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sale: PosSale | null;
  registerName: string;
}) {
  if (!sale) return null;
  const currency = sale.total.currency;
  const when = sale.soldAt ? new Date(sale.soldAt).toLocaleString() : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{sale.type === 'RETURN' ? 'Refund receipt' : 'Receipt'}</DialogTitle>
        </DialogHeader>
        <div id="pos-receipt" className="rounded-lg border bg-background p-4 font-mono text-xs leading-relaxed">
          <div className="text-center">
            <p className="text-sm font-semibold">{registerName}</p>
            <p className="text-muted-foreground">{when}</p>
            <p className="text-muted-foreground">{sale.saleNo}</p>
          </div>
          <div className="my-2 border-t border-dashed" />
          {(sale.lines ?? []).map((l) => (
            <div key={l.id} className="flex justify-between gap-2">
              <span className="truncate">
                {l.quantity}× {l.description}
              </span>
              <span className="tabular-nums">{formatMoney(l.lineTotal.amountMinor, currency)}</span>
            </div>
          ))}
          <div className="my-2 border-t border-dashed" />
          <Row label="Subtotal" value={formatMoney(sale.subtotal.amountMinor, currency)} />
          {sale.discount.amountMinor > 0 ? <Row label="Discount" value={`-${formatMoney(sale.discount.amountMinor, currency)}`} /> : null}
          {sale.tax.amountMinor > 0 ? <Row label="Tax" value={formatMoney(sale.tax.amountMinor, currency)} /> : null}
          <Row label="Total" value={formatMoney(sale.total.amountMinor, currency)} bold />
          <div className="my-2 border-t border-dashed" />
          {(sale.payments ?? []).map((p) => (
            <Row
              key={p.id}
              label={p.method + (p.cardLast4 ? ` ${p.cardScheme} ••${p.cardLast4}` : '')}
              value={formatMoney(p.amount.amountMinor, currency)}
            />
          ))}
          {sale.change.amountMinor > 0 ? <Row label="Change" value={formatMoney(sale.change.amountMinor, currency)} /> : null}
          <div className="my-2 border-t border-dashed" />
          <p className="text-center text-muted-foreground">Thank you!</p>
        </div>
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          <Button onClick={() => onOpenChange(false)}>New sale</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
