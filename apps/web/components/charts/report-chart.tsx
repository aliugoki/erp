'use client';
import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type ChartType = 'bar' | 'line' | 'area' | 'pie';

interface Col {
  key: string;
  label: string;
  money?: boolean;
}
export interface ChartableReport {
  columns: Col[];
  rows: Array<Record<string, unknown>>;
}

/** A pleasant, theme-aware categorical palette. The primary series follows the active theme; the rest
 * are fixed vivid hues that read well on light and dark. */
const PALETTE = [
  'hsl(var(--primary))',
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#8b5cf6',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
  '#a855f7',
];
const MAX_POINTS = 50;

/** Pick the value column (a `count`, else a money/number column) and a category column (the rest). */
function pickAxes(columns: Col[]): { cat: Col; val: Col } | null {
  if (columns.length < 2) return null;
  const val =
    columns.find((c) => c.key === 'count') ??
    columns.find((c) => c.money) ??
    columns.find((c) => c.key !== columns[0].key);
  if (!val) return null;
  const cat = columns.find((c) => c.key !== val.key) ?? columns[0];
  return { cat, val };
}

export function isChartable(report: ChartableReport | null): boolean {
  return !!report && report.rows.length > 0 && pickAxes(report.columns) !== null;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export function ReportChart({ report, type }: { report: ChartableReport; type: ChartType }) {
  const axes = pickAxes(report.columns);
  const data = useMemo(() => {
    if (!axes) return [];
    return report.rows.slice(0, MAX_POINTS).map((r) => ({
      name: String(r[axes.cat.key] ?? '—'),
      value: axes.val.money ? num(r[axes.val.key]) / 100 : num(r[axes.val.key]),
    }));
  }, [report, axes]);
  if (!axes) return null;

  const money = !!axes.val.money;
  const fmt = (v: number) => (money ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toLocaleString());
  const tooltipStyle = {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    color: 'hsl(var(--popover-foreground))',
    fontSize: 12,
  };
  const axisProps = { tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 11 }, stroke: 'hsl(var(--border))' };
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />;
  const tip = <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--accent))', opacity: 0.3 }} formatter={(v) => [fmt(Number(v)), axes.val.label]} />;

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {type === 'bar' ? (
          <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            {grid}
            <XAxis dataKey="name" {...axisProps} interval={0} angle={data.length > 6 ? -25 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} height={data.length > 6 ? 60 : 30} />
            <YAxis {...axisProps} width={48} tickFormatter={(v) => fmt(Number(v))} />
            {tip}
            <Bar dataKey="value" name={axes.val.label} radius={[6, 6, 0, 0]} maxBarSize={56}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Bar>
          </BarChart>
        ) : type === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            {grid}
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} width={48} tickFormatter={(v) => fmt(Number(v))} />
            {tip}
            <Line type="monotone" dataKey="value" name={axes.val.label} stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="rcArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            {grid}
            <XAxis dataKey="name" {...axisProps} />
            <YAxis {...axisProps} width={48} tickFormatter={(v) => fmt(Number(v))} />
            {tip}
            <Area type="monotone" dataKey="value" name={axes.val.label} stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#rcArea)" />
          </AreaChart>
        ) : (
          <PieChart>
            {tip}
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} innerRadius={55} paddingAngle={2} label={(e) => e.name}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
