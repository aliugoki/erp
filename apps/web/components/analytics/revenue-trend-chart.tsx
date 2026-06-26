'use client';
import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsDashboard } from '@/lib/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-02-01" → "Feb 26" without constructing a Date (avoids TZ drift on a YYYY-MM-DD). */
function monthLabel(period: string): string {
  const [y, m] = period.split('-');
  const mi = Number(m) - 1;
  return `${MONTHS[mi] ?? m} ${(y ?? '').slice(2)}`;
}

const fmtAxis = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${v}`;
};

/** Revenue vs expense (areas) and profit (line) over the available months, in major currency units. */
export function RevenueTrendChart({ dashboard }: { dashboard: AnalyticsDashboard }) {
  const data = useMemo(
    () =>
      dashboard.revenueSeries.map((s) => ({
        name: monthLabel(s.period),
        Revenue: s.revenue / 100,
        Expense: s.expense / 100,
        Profit: s.profit / 100,
      })),
    [dashboard],
  );

  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const axisProps = { tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 11 }, stroke: 'hsl(var(--border))' };

  if (data.length === 0) {
    return <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">No posted revenue yet — post finance vouchers or POS sales, then refresh.</div>;
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="rcRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="rcExpense" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.28} />
              <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
          <XAxis dataKey="name" {...axisProps} />
          <YAxis {...axisProps} width={48} tickFormatter={(v) => fmtAxis(Number(v))} />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))', fontSize: 12 }}
            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.25 }}
            formatter={(v) => fmt(Number(v))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="Revenue" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#rcRevenue)" />
          <Area type="monotone" dataKey="Expense" stroke="hsl(var(--destructive))" strokeWidth={2} fill="url(#rcExpense)" />
          <Line type="monotone" dataKey="Profit" stroke="hsl(var(--success))" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
