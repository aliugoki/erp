'use client';

const TONES: Record<string, string> = {
  // requisition + PO + gate pass + posted-doc statuses
  DRAFT: 'bg-zinc-100 text-zinc-600',
  SUBMITTED: 'bg-sky-100 text-sky-700',
  APPROVED: 'bg-indigo-100 text-indigo-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700',
  ISSUED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-zinc-200 text-zinc-600',
  CANCELLED: 'bg-rose-100 text-rose-700',
  OPEN: 'bg-sky-100 text-sky-700',
  POSTED: 'bg-emerald-100 text-emerald-700',
};

export function DocStatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONES[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status}</span>;
}

export function DirectionBadge({ direction }: { direction: string }) {
  const inward = direction === 'INWARD';
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${inward ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{direction}</span>;
}

export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
