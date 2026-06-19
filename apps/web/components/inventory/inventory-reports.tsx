'use client';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { ReorderLine, StockReport } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';

/** Stock valuation + reorder suggestions (read-only). The per-item valued ledger lives on the product. */
export function InventoryReports() {
  const stock = useQuery({ queryKey: ['stock-report'], queryFn: () => apiGet<StockReport>('/inventory/reports/stock') });
  const reorder = useQuery({ queryKey: ['reorder'], queryFn: () => apiGet<ReorderLine[]>('/inventory/reports/reorder') });

  if (stock.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const s = stock.data;
  const reorderRows = reorder.data ?? [];

  return (
    <>
      <PaneHeader><span className="font-semibold">Stock valuation</span>{s ? <span className="ml-auto text-sm text-muted-foreground">{s.totals.items} items · <span className="font-semibold text-foreground">{formatMoney(s.totals.value.amountMinor, s.totals.value.currency)}</span></span> : null}</PaneHeader>
      <PaneBody className="space-y-6 p-5">
        {reorderRows.length > 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">Reorder ({reorderRows.length})</h3>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Min</th><th className="px-4 py-2 text-right">Suggested</th></tr></thead>
                <tbody className="divide-y">
                  {reorderRows.map((r) => (
                    <tr key={r.id}><td className="px-4 py-2"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground">{r.sku}</span></td><td className="px-4 py-2 text-right tabular-nums text-amber-600">{r.onHand}</td><td className="px-4 py-2 text-right tabular-nums">{r.minStock}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{r.suggestedQty} {r.unit}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valuation</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2">Category</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Unit cost</th><th className="px-4 py-2 text-right">Value</th></tr></thead>
              <tbody className="divide-y">
                {(s?.lines ?? []).map((l) => (
                  <tr key={l.id} className={l.belowReorder ? 'bg-amber-50/50' : ''}>
                    <td className="px-4 py-2"><span className="font-medium">{l.name}</span> <span className="text-xs text-muted-foreground">{l.sku}</span></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{l.category ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.onHand} {l.unit}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.unitCost.amountMinor, l.unitCost.currency)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(l.value.amountMinor, l.value.currency)}</td>
                  </tr>
                ))}
                {(s?.lines ?? []).length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No stock yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}
