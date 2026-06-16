'use client';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Trophy } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { ForecastReport, LeadFunnelRow, SalesByOwnerRow, WinLossReport } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { CrmTabs } from '@/components/crm/crm-tabs';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STAGE_LABEL: Record<string, string> = {
  LEAD: 'Lead', QUALIFIED: 'Qualified', PROPOSAL: 'Proposal', NEGOTIATION: 'Negotiation',
  NEW: 'New', CONTACTED: 'Contacted', UNQUALIFIED: 'Unqualified', CONVERTED: 'Converted',
};

export default function CrmReportsPage() {
  const forecast = useQuery({ queryKey: ['forecast'], queryFn: () => apiGet<ForecastReport>('/crm/reports/forecast') });
  const winLoss = useQuery({ queryKey: ['win-loss'], queryFn: () => apiGet<WinLossReport>('/crm/reports/win-loss') });
  const byOwner = useQuery({ queryKey: ['sales-by-owner'], queryFn: () => apiGet<SalesByOwnerRow[]>('/crm/reports/sales-by-owner') });
  const funnel = useQuery({ queryKey: ['lead-funnel'], queryFn: () => apiGet<LeadFunnelRow[]>('/crm/reports/lead-funnel') });

  const f = forecast.data;
  const wl = winLoss.data;
  const owners = byOwner.data ?? [];
  const funnelRows = funnel.data ?? [];
  const funnelMax = Math.max(1, ...funnelRows.map((r) => r.count));

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="CRM" description="Forecast, win/loss and the sales leaderboard." />
      <CrmTabs />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Gauge}
          label="Weighted forecast"
          value={Math.round((f?.weightedTotal.amountMinor ?? 0) / 100)}
          format={(v) => `${f?.weightedTotal.currency ?? 'PKR'} ${v.toLocaleString()}`}
          accent="primary"
          delayMs={0}
        />
        <StatCard
          icon={Trophy}
          label="Won value"
          value={Math.round((wl?.won.value.amountMinor ?? 0) / 100)}
          format={(v) => `${wl?.won.value.currency ?? 'PKR'} ${v.toLocaleString()}`}
          accent="success"
          delayMs={70}
        />
        <StatCard icon={Trophy} label="Win rate" value={wl?.winRate ?? 0} format={(v) => `${v}%`} accent="primary" delayMs={140} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 font-medium">Weighted pipeline forecast</p>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Stage</TableHead><TableHead className="text-right">Deals</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">Weighted</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(f?.stages ?? []).map((s) => (
                <TableRow key={s.stage}>
                  <TableCell>{STAGE_LABEL[s.stage] ?? s.stage}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(s.total.amountMinor, s.total.currency)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(s.weighted.amountMinor, s.weighted.currency)}</TableCell>
                </TableRow>
              ))}
              {f ? (
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(f.openTotal.amountMinor, f.openTotal.currency)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(f.weightedTotal.amountMinor, f.weightedTotal.currency)}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-4">
          <p className="mb-3 font-medium">Lead funnel</p>
          <div className="space-y-3">
            {funnelRows.map((r) => (
              <div key={r.status}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{STAGE_LABEL[r.status] ?? r.status}</span>
                  <span className="tabular-nums text-muted-foreground">{r.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(r.count / funnelMax) * 100}%` }} />
                </div>
              </div>
            ))}
            {funnelRows.length === 0 ? <p className="text-sm text-muted-foreground">No leads yet.</p> : null}
          </div>

          <p className="mb-3 mt-6 font-medium">Sales leaderboard</p>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Owner</TableHead><TableHead className="text-right">Won</TableHead><TableHead className="text-right">Value</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((o, i) => (
                <TableRow key={o.ownerId ?? `none-${i}`}>
                  <TableCell className="font-mono text-xs">{o.ownerId ? o.ownerId.slice(0, 8) : 'Unassigned'}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.wonCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(o.wonValue.amountMinor, o.wonValue.currency)}</TableCell>
                </TableRow>
              ))}
              {owners.length === 0 ? <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground">No won deals yet.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
