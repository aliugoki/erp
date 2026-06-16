'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Sparkles, TrendingUp, Users } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { AiSummary, AttritionRisk, InventoryDemand, LeadScore, SalesForecast } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const BAND: Record<string, 'success' | 'warning' | 'destructive'> = { LOW: 'success', MEDIUM: 'warning', HIGH: 'destructive' };

export default function AiInsightsPage() {
  const summary = useQuery({ queryKey: ['ai-summary'], queryFn: () => apiGet<AiSummary>('/ai/insights/summary') });
  const forecast = useQuery({ queryKey: ['ai-forecast'], queryFn: () => apiGet<SalesForecast>('/ai/insights/sales-forecast') });
  const leads = useQuery({ queryKey: ['ai-leads'], queryFn: () => apiGet<LeadScore[]>('/ai/insights/lead-scores') });
  const demand = useQuery({ queryKey: ['ai-demand'], queryFn: () => apiGet<InventoryDemand[]>('/ai/insights/inventory-demand') });
  const attrition = useQuery({ queryKey: ['ai-attrition'], queryFn: () => apiGet<AttritionRisk[]>('/ai/insights/attrition-risk') });

  const s = summary.data;
  const fc = forecast.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="AI Insights" description="ML-powered forecasting, scoring and anomaly detection across your data." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={TrendingUp} label="Forecast next-month sales" value={Math.round((s?.nextMonthSales.amountMinor ?? 0) / 100)} format={(v) => `${s?.nextMonthSales.currency ?? 'PKR'} ${v.toLocaleString()}`} accent="primary" delayMs={0} />
        <StatCard icon={Sparkles} label="Hot leads" value={s?.hotLeads ?? 0} accent="warning" delayMs={60} />
        <StatCard icon={AlertTriangle} label="Reorder soon" value={s?.reorderProducts ?? 0} accent={s?.reorderProducts ? 'warning' : 'success'} delayMs={120} />
        <StatCard icon={Users} label="Attrition risk" value={s?.atRiskEmployees ?? 0} accent={s?.atRiskEmployees ? 'warning' : 'success'} delayMs={180} />
      </div>

      <Card className="p-4">
        <p className="mb-3 flex items-center gap-2 font-medium"><TrendingUp className="size-4" /> Sales forecast (least-squares trend)</p>
        <div className="flex flex-wrap items-end gap-2">
          {(fc?.history ?? []).map((h) => (
            <div key={h.month} className="flex flex-col items-center gap-1">
              <div className="w-10 rounded-t bg-muted" style={{ height: barH(h.valueMinor, fc) }} />
              <span className="text-[10px] text-muted-foreground">{h.month.slice(5)}</span>
            </div>
          ))}
          {(fc?.forecastMinor ?? []).map((v, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-10 rounded-t bg-primary/70" style={{ height: barH(v, fc) }} title="forecast" />
              <span className="text-[10px] text-primary">+{i + 1}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Forecast: {(fc?.forecastMinor ?? []).map((v) => formatMoney(v, fc?.currency ?? 'PKR')).join(' · ') || '—'}
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <p className="border-b p-3 font-medium">Top scored leads</p>
          <Table>
            <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Value</TableHead><TableHead className="text-right">Score</TableHead></TableRow></TableHeader>
            <TableBody>
              {(leads.data ?? []).slice(0, 8).map((l) => (
                <TableRow key={l.id}>
                  <TableCell><span className="font-medium">{l.name}</span>{l.company ? <span className="text-xs text-muted-foreground"> · {l.company}</span> : null}</TableCell>
                  <TableCell className="tabular-nums">{formatMoney(l.estValue.amountMinor, l.estValue.currency)}</TableCell>
                  <TableCell className="text-right"><Badge variant={BAND[l.band] ?? 'secondary'}>{l.score}</Badge></TableCell>
                </TableRow>
              ))}
              {(leads.data ?? []).length === 0 ? <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground">No open leads.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <p className="border-b p-3 font-medium">Attrition risk</p>
          <Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="text-right">Absence</TableHead><TableHead className="text-right">Risk</TableHead></TableRow></TableHeader>
            <TableBody>
              {(attrition.data ?? []).slice(0, 8).map((a) => (
                <TableRow key={a.employeeId}>
                  <TableCell className="font-medium">{a.employeeName}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.absenceRatePct}%</TableCell>
                  <TableCell className="text-right"><Badge variant={BAND[a.band] ?? 'secondary'}>{a.band.toLowerCase()}</Badge></TableCell>
                </TableRow>
              ))}
              {(attrition.data ?? []).length === 0 ? <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground">No employees.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <p className="border-b p-3 font-medium">Inventory demand & stockout prediction</p>
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Avg/day</TableHead><TableHead className="text-right">30-day forecast</TableHead><TableHead className="text-right">Days to stockout</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {(demand.data ?? []).slice(0, 10).map((d) => (
              <TableRow key={d.id}>
                <TableCell><span className="font-medium">{d.name}</span> <span className="font-mono text-xs text-muted-foreground">{d.sku}</span></TableCell>
                <TableCell className="text-right tabular-nums">{d.onHand}</TableCell>
                <TableCell className="text-right tabular-nums">{d.avgDailyDemand}</TableCell>
                <TableCell className="text-right tabular-nums">{d.forecast30}</TableCell>
                <TableCell className="text-right tabular-nums">{d.daysToStockout ?? '—'}</TableCell>
                <TableCell className="text-right">{d.reorder ? <Badge variant="warning">Reorder</Badge> : <Badge variant="secondary">OK</Badge>}</TableCell>
              </TableRow>
            ))}
            {(demand.data ?? []).length === 0 ? <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No products.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function barH(v: number, fc?: SalesForecast): string {
  const all = [...(fc?.history ?? []).map((h) => h.valueMinor), ...(fc?.forecastMinor ?? [])];
  const max = Math.max(1, ...all);
  return `${Math.max(4, Math.round((v / max) * 80))}px`;
}
