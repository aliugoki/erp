'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import {
  DISPENSE_LABEL,
  StatusBadge,
  Spinner,
  fmtDate,
  type DispenseDetailData,
} from '@/components/pharmacy/pharm-ui';

export function DispenseDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const dispenseQ = useQuery({ queryKey: ['pharm-dispense', id], queryFn: () => apiGet<DispenseDetailData>(`/pharmacy/dispenses/${id}`) });
  const d = dispenseQ.data;

  const ret = useMutation({
    mutationFn: () => apiPost(`/pharmacy/dispenses/${id}/return`, { reason: 'Counter return' }),
    onSuccess: () => {
      toast.success('Dispense returned');
      void qc.invalidateQueries({ queryKey: ['pharm-dispense', id] });
      void qc.invalidateQueries({ queryKey: ['pharm-dispenses'] });
      void qc.invalidateQueries({ queryKey: ['pharm-lots'] });
      void qc.invalidateQueries({ queryKey: ['pharm-drugs'] });
      onBack();
    },
    onError: (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  if (dispenseQ.isLoading) return <Spinner />;
  if (dispenseQ.isError || !d) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Dispense not found.</div>;

  return (
    <>
      <PaneHeader>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{d.dispenseNo}</span>
          <StatusBadge status={d.status} />
        </div>
        {d.status === 'COMPLETED' ? (
          <Button variant="outline" size="sm" onClick={() => ret.mutate()} disabled={ret.isPending}><RotateCcw className="mr-1.5 h-4 w-4" /> Return / reverse</Button>
        ) : null}
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Info label="Type" value={DISPENSE_LABEL[d.type] ?? d.type} />
          <Info label="Customer" value={d.customer ?? d.patientRef ?? '—'} />
          <Info label="Prescriber" value={d.prescriber ?? '—'} />
          <Info label="Prescription ref" value={d.prescriptionRef ?? '—'} />
          <Info label="Ward" value={d.ward ?? '—'} />
          <Info label="Payment" value={d.paymentMethod} />
          <Info label="Insurer" value={d.insurer ?? '—'} />
          <Info label="Insurance cover" value={formatMoney(d.insuranceCover.amountMinor, d.insuranceCover.currency)} />
          <Info label="Date" value={fmtDate(d.occurredOn)} />
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line items</h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Lot</th>
                  <th className="px-3 py-2 font-medium">Expiry</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Unit</th>
                  <th className="px-3 py-2 text-right font-medium">Disc</th>
                  <th className="px-3 py-2 text-right font-medium">Tax</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="px-3 py-2"><span className="font-medium">{it.name}</span> <span className="font-mono text-xs text-muted-foreground">{it.sku}</span></td>
                    <td className="px-3 py-2 font-mono text-xs">{it.lotNo ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(it.expiryDate)}</td>
                    <td className="px-3 py-2 text-right">{it.qty}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(it.unitPrice.amountMinor, it.unitPrice.currency)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(it.discount.amountMinor, it.discount.currency)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(it.tax.amountMinor, it.tax.currency)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(it.lineTotal.amountMinor, it.lineTotal.currency)}</td>
                  </tr>
                ))}
                {d.items.length === 0 ? <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">No items.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid max-w-xs gap-1.5 text-sm">
          <Total label="Subtotal" value={formatMoney(d.subtotal.amountMinor, d.subtotal.currency)} />
          <Total label="Discount" value={formatMoney(d.discount.amountMinor, d.discount.currency)} />
          <Total label="Tax" value={formatMoney(d.tax.amountMinor, d.tax.currency)} />
          <Total label="Total" value={formatMoney(d.total.amountMinor, d.total.currency)} strong />
          <Total label="COGS" value={formatMoney(d.cogs.amountMinor, d.cogs.currency)} />
        </section>
      </PaneBody>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 truncate font-medium">{value}</p></div>;
}
function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between ${strong ? 'border-t pt-1.5 font-semibold' : ''}`}><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}
