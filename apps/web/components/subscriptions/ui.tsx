'use client';

const SUB_STATUS_TONE: Record<string, string> = {
  TRIALING: 'bg-sky-100 text-sky-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PAST_DUE: 'bg-amber-100 text-amber-700',
  PAUSED: 'bg-zinc-200 text-zinc-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
  EXPIRED: 'bg-zinc-100 text-zinc-500',
};

const INVOICE_STATUS_TONE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  VOID: 'bg-zinc-100 text-zinc-500',
  UNCOLLECTIBLE: 'bg-rose-100 text-rose-700',
};

export function SubStatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${SUB_STATUS_TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status.replace('_', ' ')}</span>;
}

export function InvoiceStatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${INVOICE_STATUS_TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status}</span>;
}

const UNIT_NOUN: Record<string, string> = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' };
const UNIT_ADVERB: Record<string, string> = { DAY: 'daily', WEEK: 'weekly', MONTH: 'monthly', YEAR: 'yearly' };

/** "monthly", "yearly", or "every 3 months" for a billing interval + count. */
export function intervalLabel(interval: string, count: number): string {
  if (count === 1) return UNIT_ADVERB[interval] ?? interval.toLowerCase();
  return `every ${count} ${UNIT_NOUN[interval] ?? interval.toLowerCase()}s`;
}

/** "/mo", "/yr" short suffix for a price. */
export function intervalSuffix(interval: string, count: number): string {
  const short: Record<string, string> = { DAY: 'day', WEEK: 'wk', MONTH: 'mo', YEAR: 'yr' };
  return count === 1 ? `/${short[interval] ?? ''}` : `/${count}${short[interval] ?? ''}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeUntil(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (Math.abs(days) >= 1) return days > 0 ? `in ${days}d` : `${-days}d ago`;
  const hrs = Math.round(ms / 3_600_000);
  return hrs >= 0 ? `in ${hrs}h` : `${-hrs}h ago`;
}
