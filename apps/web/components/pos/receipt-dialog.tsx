'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Printer } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { FbrInvoice, PosBranding, PosSale } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { AuthImage } from '@/components/auth-image';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Post-sale receipt — a monospace ticket the cashier can print (browser print) or read back. */
export function ReceiptDialog({
  open,
  onOpenChange,
  sale,
  registerName,
  branding,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sale: PosSale | null;
  registerName: string;
  branding?: PosBranding | null;
}) {
  // FBR digital invoice for this sale (auto-reported async after completion). Polls briefly until the
  // FBR number lands; silently absent when the tax feature is off, offline, or not yet reported.
  const fbrQuery = useQuery({
    queryKey: ['fbr-sale', sale?.id],
    queryFn: () => apiGet<FbrInvoice | null>(`/tax/fbr/sale/${sale!.id}`).catch(() => null),
    enabled: !!sale && open && sale.type !== 'RETURN',
    refetchInterval: (q) => (q.state.data?.status === 'REPORTED' ? false : q.state.dataUpdateCount < 6 ? 2000 : false),
  });
  const fbr = fbrQuery.data && fbrQuery.data.status === 'REPORTED' ? fbrQuery.data : null;
  const [qrSrc, setQrSrc] = useState('');
  useEffect(() => {
    if (fbr?.qr) QRCode.toDataURL(fbr.qr, { width: 120, margin: 1 }).then(setQrSrc).catch(() => setQrSrc(''));
    else setQrSrc('');
  }, [fbr?.qr]);

  if (!sale) return null;
  const currency = sale.total.currency;
  const when = sale.soldAt ? new Date(sale.soldAt).toLocaleString() : '';
  const footer = branding?.receiptFooter?.trim() || 'Thank you!';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{sale.type === 'RETURN' ? 'Refund receipt' : 'Receipt'}</DialogTitle>
        </DialogHeader>
        <div id="pos-receipt" className="rounded-lg border bg-background p-4 font-mono text-xs leading-relaxed">
          <div className="text-center">
            {branding?.hasLogo ? (
              <AuthImage
                path="/pos/branding/logo"
                alt={branding.storeName ?? registerName}
                className="mx-auto mb-2 h-16 w-auto max-w-[180px] object-contain"
              />
            ) : null}
            <p className="text-sm font-semibold">{branding?.storeName?.trim() || registerName}</p>
            {branding?.address?.trim() ? (
              <p className="whitespace-pre-line text-muted-foreground">{branding.address}</p>
            ) : null}
            {branding?.phone?.trim() ? <p className="text-muted-foreground">{branding.phone}</p> : null}
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
          {fbr ? (
            <>
              <div className="my-2 border-t border-dashed" />
              <div className="flex flex-col items-center gap-1 text-center">
                {qrSrc ? <img src={qrSrc} alt="FBR QR" width={96} height={96} className="rounded bg-white p-1" /> : null}
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">FBR Invoice</p>
                <p className="font-semibold">{fbr.fbrInvoiceNumber}</p>
                <p className="text-[10px] text-muted-foreground">Verify at fbr.gov.pk</p>
              </div>
            </>
          ) : null}
          <div className="my-2 border-t border-dashed" />
          <p className="whitespace-pre-line text-center text-muted-foreground">{footer}</p>
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
