'use client';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Loader2, Trophy } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { ForecastReport, LeadFunnelRow, SalesByOwnerRow, WinLossReport } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { ModuleReports } from '@/components/reports/module-reports';
import { StageBadge } from './crm-ui';

const STAGE_LABEL: Record<string, string> = {
  LEAD: 'Lead', QUALIFIED: 'Qualified', PROPOSAL: 'Proposal', NEGOTIATION: 'Negotiation',
  NEW: 'New', CONTACTED: 'Contacted', UNQUALIFIED: 'Unqualified', CONVERTED: 'Converted',
};

/** Sales analytics dashboard — forecast, win/loss, leaderboard, lead funnel. Read-only. */
export function CrmReports() {
  const forecast = useQuery({ queryKey: ['forecast'], queryFn: () => apiGet<ForecastReport>('/crm/reports/forecast') });
  const winLoss = useQuery({ queryKey: ['win-loss'], queryFn: () => apiGet<WinLossReport>('/crm/reports/win-loss') });
  const byOwner = useQuery({ queryKey: ['sales-by-owner'], queryFn: () => apiGet<SalesByOwnerRow[]>('/crm/reports/sales-by-owner') });
  const funnel = useQuery({ queryKey: ['lead-funnel'], queryFn: () => apiGet<LeadFunnelRow[]>('/crm/reports/lead-funnel') });

  const f = forecast.data;
  const wl = winLoss.data;
  const owners = byOwner.data ?? [];
  const funnelRows = funnel.data ?? [];
  const funnelMax = Math.max(1, ...funnelRows.map((r) => r.count));

  if (forecast.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      <PaneHeader><span className="font-semibold">Sales reports</span></PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi icon={Gauge} label="Weighted forecast" value={f ? formatMoney(f.weightedTotal.amountMinor, f.weightedTotal.currency) : '—'} />
          <Kpi icon={Gauge} label="Open pipeline" value={f ? formatMoney(f.openTotal.amountMinor, f.openTotal.currency) : '—'} />
          <Kpi icon={Trophy} label="Win rate" value={wl ? `${wl.winRate}%` : '—'} sub={wl ? `${wl.won.count} won · ${wl.lost.count} lost` : ''} />
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forecast by stage</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Stage</th><th className="px-4 py-2 text-right">Deals</th><th className="px-4 py-2 text-right">Value</th><th className="px-4 py-2 text-right">Weighted</th></tr></thead>
              <tbody className="divide-y">
                {(f?.stages ?? []).map((s) => (
                  <tr key={s.stage}><td className="px-4 py-2"><StageBadge stage={s.stage} /></td><td className="px-4 py-2 text-right tabular-nums">{s.count}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(s.total.amountMinor, s.total.currency)}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(s.weighted.amountMinor, s.weighted.currency)}</td></tr>
                ))}
                {(f?.stages ?? []).length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No open deals.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead funnel</h3>
            <div className="space-y-2">
              {funnelRows.map((r) => (
                <div key={r.status} className="flex items-center gap-3">
                  <span className="w-24 text-xs text-muted-foreground">{STAGE_LABEL[r.status] ?? r.status}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary/70" style={{ width: `${(r.count / funnelMax) * 100}%` }} /></div>
                  <span className="w-8 text-right text-xs tabular-nums">{r.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales leaderboard</h3>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Owner</th><th className="px-4 py-2 text-right">Won</th><th className="px-4 py-2 text-right">Value</th></tr></thead>
                <tbody className="divide-y">
                  {owners.map((o, i) => (
                    <tr key={o.ownerId ?? i}><td className="px-4 py-2 font-mono text-xs">{o.ownerId ? `${o.ownerId.slice(0, 8)}…` : 'Unassigned'}</td><td className="px-4 py-2 text-right tabular-nums">{o.wonCount}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(o.wonValue.amountMinor, o.wonValue.currency)}</td></tr>
                  ))}
                  {owners.length === 0 ? <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No closed-won deals yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <ModuleReports sources={['crm_deals', 'crm_leads']} />
      </PaneBody>
    </>
  );
}

function Kpi({ icon: Icon, label, value, sub = '' }: { icon: typeof Gauge; label: string; value: string; sub?: string }) {
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className="h-4 w-4 text-primary" /></div><p className="mt-2 text-xl font-bold tabular-nums">{value}</p>{sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}</div>;
}
