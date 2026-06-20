'use client';

const TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  ON_LEAVE: 'bg-amber-100 text-amber-700',
  TERMINATED: 'bg-rose-100 text-rose-700',
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  DRAFT: 'bg-zinc-100 text-zinc-600',
  PAID: 'bg-emerald-100 text-emerald-700',
  SUBMITTED: 'bg-emerald-100 text-emerald-700',
  NOT_STARTED: 'bg-zinc-100 text-zinc-600',
  IN_PROGRESS: 'bg-sky-100 text-sky-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
  ARCHIVED: 'bg-zinc-200 text-zinc-600',
  PRESENT: 'bg-emerald-100 text-emerald-700',
  HALF_DAY: 'bg-amber-100 text-amber-700',
  LEAVE: 'bg-sky-100 text-sky-700',
  ABSENT: 'bg-rose-100 text-rose-700',
};

export function HrStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status.replace('_', ' ')}</span>;
}

export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
