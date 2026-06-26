'use client';
import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Boxes, type LucideIcon, Minus, Target, TrendingUp, Trophy, Users, Wallet } from 'lucide-react';
import type { AnalyticsKpi } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { Card } from '@/components/ui/card';

/** Per-KPI icon + accent colour, so each tile reads at a glance. */
const ICONS: Record<string, { icon: LucideIcon; tint: string; chip: string }> = {
  revenue: { icon: Wallet, tint: 'text-primary', chip: 'bg-primary/10' },
  profit: { icon: TrendingUp, tint: 'text-success', chip: 'bg-success/10' },
  pipeline: { icon: Target, tint: 'text-violet-500', chip: 'bg-violet-500/10' },
  won: { icon: Trophy, tint: 'text-amber-500', chip: 'bg-amber-500/10' },
  inventory: { icon: Boxes, tint: 'text-cyan-500', chip: 'bg-cyan-500/10' },
  headcount: { icon: Users, tint: 'text-rose-500', chip: 'bg-rose-500/10' },
};

/** Compact value formatting for KPI tiles — money in major units (K/M/B), counts plain. */
function formatValue(kpi: AnalyticsKpi): string {
  if (!kpi.money) return kpi.value.toLocaleString();
  const major = kpi.value / 100;
  const abs = Math.abs(major);
  const sym = (n: number, s: string) => `${(major / n).toFixed(abs / n >= 100 ? 0 : 1)}${s}`;
  const body = abs >= 1_000_000_000 ? sym(1_000_000_000, 'B') : abs >= 1_000_000 ? sym(1_000_000, 'M') : abs >= 10_000 ? sym(1_000, 'K') : formatMoney(kpi.value, kpi.currency);
  // formatMoney already prefixes the currency; the abbreviated forms don't, so prefix here.
  return abs >= 10_000 ? `${kpi.currency ?? ''} ${body}`.trim() : body;
}

export function KpiCard({ kpi, delayMs = 0 }: { kpi: AnalyticsKpi; delayMs?: number }) {
  const data = useMemo(() => (kpi.trend ?? []).map((y, i) => ({ i, y: kpi.money ? y / 100 : y })), [kpi]);
  const delta = kpi.deltaPct;
  const up = typeof delta === 'number' && delta > 0;
  const down = typeof delta === 'number' && delta < 0;
  const tone = up ? 'success' : down ? 'destructive' : 'muted-foreground';
  const stroke = up ? 'hsl(var(--success))' : down ? 'hsl(var(--destructive))' : 'hsl(var(--primary))';
  const gid = `kpi-${kpi.key}`;
  const meta = ICONS[kpi.key] ?? { icon: Wallet, tint: 'text-primary', chip: 'bg-primary/10' };
  const Icon = meta.icon;

  return (
    <Card className="glass elevated hover-lift group relative overflow-hidden animate-fade-up" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="relative flex flex-col gap-1 p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
          <span className={cn('flex size-8 items-center justify-center rounded-lg', meta.chip, meta.tint)}>
            <Icon className="size-4" />
          </span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tabular-nums leading-none">{formatValue(kpi)}</p>
          {typeof delta === 'number' ? (
            <span className={cn('flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold', `text-${tone}`, up && 'bg-success/10', down && 'bg-destructive/10')}>
              {up ? <ArrowUpRight className="size-3" /> : down ? <ArrowDownRight className="size-3" /> : <Minus className="size-3" />}
              {Math.abs(delta)}%
            </span>
          ) : null}
        </div>
        {kpi.subtitle ? <p className="truncate text-xs text-muted-foreground/80">{kpi.subtitle}</p> : null}
      </div>
      {data.length > 1 ? (
        <div className="h-12 w-full opacity-90">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="y" stroke={stroke} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </Card>
  );
}
