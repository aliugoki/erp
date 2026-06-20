'use client';

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-600',
  SENT: 'bg-sky-100 text-sky-700',
  RECEIVED: 'bg-sky-100 text-sky-700',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  POSTED: 'bg-emerald-100 text-emerald-700',
  OPEN: 'bg-sky-100 text-sky-700',
  CLOSED: 'bg-zinc-200 text-zinc-600',
  VOID: 'bg-rose-100 text-rose-700',
};

const ACCOUNT_TONE: Record<string, string> = {
  ASSET: 'bg-sky-100 text-sky-700',
  LIABILITY: 'bg-amber-100 text-amber-700',
  EQUITY: 'bg-violet-100 text-violet-700',
  REVENUE: 'bg-emerald-100 text-emerald-700',
  EXPENSE: 'bg-rose-100 text-rose-700',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status.replace('_', ' ')}</span>;
}

export function AccountTypeBadge({ type }: { type: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACCOUNT_TONE[type] ?? 'bg-zinc-100 text-zinc-600'}`}>{type}</span>;
}

export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
