'use client';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { MaterialShortage, ProductionOrder, ProductionOutputRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { ProdBadge } from './prod-ui';

function Spinner() {
  return <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}

function Shortages() {
  const q = useQuery({ queryKey: ['prod-shortages'], queryFn: () => apiGet<MaterialShortage[]>('/production/reports/shortages') });
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Material shortages</h3>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Component</th><th className="px-4 py-2 text-right">Needed</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Short by</th></tr></thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No shortages</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.componentProductId}>
                  <td className="px-4 py-2">{r.componentName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.needed}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.onHand}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${r.shortBy > 0 ? 'text-rose-600' : ''}`}>{r.shortBy}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Output() {
  const q = useQuery({ queryKey: ['prod-output'], queryFn: () => apiGet<ProductionOutputRow[]>('/production/reports/output') });
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Output</h3>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">Orders</th><th className="px-4 py-2 text-right">Produced</th><th className="px-4 py-2 text-right">Total cost</th></tr></thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No output.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.productId}>
                  <td className="px-4 py-2">{r.productName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.orders}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.producedQty}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.totalCost.amountMinor, r.totalCost.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Wip() {
  const q = useQuery({ queryKey: ['prod-wip'], queryFn: () => apiGet<ProductionOrder[]>('/production/reports/wip') });
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work in progress</h3>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">Product</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Planned</th><th className="px-4 py-2 text-right">Total cost</th></tr></thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No work in progress.</td></tr>
            ) : (
              rows.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2 font-medium">{o.orderNo}</td>
                  <td className="px-4 py-2">{o.productName}</td>
                  <td className="px-4 py-2"><ProdBadge status={o.status} /></td>
                  <td className="px-4 py-2 text-right tabular-nums">{o.plannedQty}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(o.totalCost.amountMinor, o.totalCost.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ProductionReports() {
  return (
    <>
      <PaneHeader>
        <span className="font-semibold">Production reports</span>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <Shortages />
        <Output />
        <Wip />
      </PaneBody>
    </>
  );
}
