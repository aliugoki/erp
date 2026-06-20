'use client';

const TONE: Record<string, string> = {
  PARKED: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  VOIDED: 'bg-zinc-200 text-zinc-600',
  PARTIALLY_REFUNDED: 'bg-sky-100 text-sky-700',
  REFUNDED: 'bg-rose-100 text-rose-700',
  OPEN: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-zinc-200 text-zinc-600',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INACTIVE: 'bg-zinc-100 text-zinc-500',
  SALE: 'bg-sky-100 text-sky-700',
  RETURN: 'bg-rose-100 text-rose-700',
};

export function PosBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status.replace(/_/g, ' ')}</span>;
}

export const fmtDateTime = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
