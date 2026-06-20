'use client';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { AssetDepreciationRun, AssetMaintenance, AssetRegisterRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { AssetBadge, fmtDate } from './asset-ui';
import { RunDepreciationDialog } from './run-depreciation-dialog';

export function AssetReports() {
  const register = useQuery({ queryKey: ['asset-register'], queryFn: () => apiGet<AssetRegisterRow[]>('/assets/reports/register') });
  const runs = useQuery({ queryKey: ['asset-runs'], queryFn: () => apiGet<AssetDepreciationRun[]>('/assets/depreciation/runs') });
  const upcoming = useQuery({ queryKey: ['asset-upcoming'], queryFn: () => apiGet<AssetMaintenance[]>('/assets/maintenance/upcoming') });

  return (
    <>
      <PaneHeader>
        <span className="font-semibold">Asset reports</span>
        <div className="ml-auto"><RunDepreciationDialog /></div>
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Register by category</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Category</th><th className="px-4 py-2 text-right">Count</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-right">Accum.</th><th className="px-4 py-2 text-right">Book value</th></tr></thead>
              <tbody className="divide-y">
                {register.isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                ) : (register.data ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No assets.</td></tr>
                ) : (
                  (register.data ?? []).map((r) => (
                    <tr key={r.category}>
                      <td className="px-4 py-2 font-medium">{r.category}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.cost.amountMinor, r.cost.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.accumulated.amountMinor, r.accumulated.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.bookValue.amountMinor, r.bookValue.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Depreciation runs</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Run</th><th className="px-4 py-2">Period</th><th className="px-4 py-2 text-right">Assets</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2">Status</th></tr></thead>
              <tbody className="divide-y">
                {runs.isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                ) : (runs.data ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No depreciation runs.</td></tr>
                ) : (
                  (runs.data ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-mono text-xs">{r.runNo}</td>
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(r.period)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.assetCount}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.total.amountMinor, r.total.currency)}</td>
                      <td className="px-4 py-2"><AssetBadge status={r.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming maintenance</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Asset</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Next due</th><th className="px-4 py-2 text-right">Cost</th></tr></thead>
              <tbody className="divide-y">
                {upcoming.isLoading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                ) : (upcoming.data ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Nothing due.</td></tr>
                ) : (
                  (upcoming.data ?? []).map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2 font-medium">{m.assetName ?? '—'}</td>
                      <td className="px-4 py-2">{m.type}</td>
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(m.nextDueDate)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(m.cost.amountMinor, m.cost.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}
