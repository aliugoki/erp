'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { PosDailySummary } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';

interface TopProduct { productId: string; description: string; quantity: number; revenueMinor: number }

const today = (): string => new Date().toISOString().slice(0, 10);

/** Read-only POS analytics: a per-day sales/returns/margin summary and a top-products leaderboard. */
export function PosReports() {
  const [date, setDate] = useState(today());
  const daily = useQuery({ queryKey: ['pos-daily', date], queryFn: () => apiGet<PosDailySummary>(`/pos/reports/daily?date=${date}`) });
  const top = useQuery({ queryKey: ['pos-top'], queryFn: () => apiGet<TopProduct[]>('/pos/reports/top-products?limit=10') });
  const d = daily.data;

  return (
    <>
      <PaneHeader>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
        />
        <span className="text-sm text-muted-foreground">Daily report</span>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day summary</h3>
          {daily.isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : d ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Sales count" value={String(d.saleCount)} />
                <Tile label="Returns" value={String(d.returnCount)} />
                <Tile label="Gross" value={formatMoney(d.grossSalesMinor, 'PKR')} />
                <Tile label="Refunds" value={formatMoney(d.refundsMinor, 'PKR')} />
                <Tile label="Net" value={formatMoney(d.netSalesMinor, 'PKR')} />
                <Tile label="COGS" value={formatMoney(d.cogsMinor, 'PKR')} />
                <Tile label="Margin" value={formatMoney(d.grossMarginMinor, 'PKR')} />
              </div>
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Tender</th><th className="px-4 py-2 text-right">Amount</th></tr></thead>
                  <tbody className="divide-y">
                    {d.tenders.length === 0 ? (
                      <tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">No tenders.</td></tr>
                    ) : (
                      d.tenders.map((t) => (
                        <tr key={t.method}>
                          <td className="px-4 py-2">{t.method}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.amountMinor, 'PKR')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top products</h3>
          {top.isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Revenue</th></tr></thead>
                <tbody className="divide-y">
                  {(top.data ?? []).length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No sales yet.</td></tr>
                  ) : (
                    (top.data ?? []).map((p) => (
                      <tr key={p.productId}>
                        <td className="px-4 py-2">{p.description}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.quantity}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.revenueMinor, 'PKR')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PaneBody>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}
