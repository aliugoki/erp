'use client';

const TONE: Record<string, string> = {
  PLANNED: 'bg-sky-100 text-sky-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  ON_HOLD: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-zinc-200 text-zinc-600',
  CANCELLED: 'bg-rose-100 text-rose-700',
  TODO: 'bg-zinc-100 text-zinc-600',
  IN_PROGRESS: 'bg-sky-100 text-sky-700',
  BLOCKED: 'bg-rose-100 text-rose-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  DRAFT: 'bg-zinc-100 text-zinc-600',
  SUBMITTED: 'bg-sky-100 text-sky-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-700',
};
const PRIORITY: Record<string, string> = {
  LOW: 'bg-zinc-100 text-zinc-500',
  NORMAL: 'bg-sky-100 text-sky-700',
  HIGH: 'bg-amber-100 text-amber-700',
  URGENT: 'bg-rose-100 text-rose-700',
};

export function ProjBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status.replace(/_/g, ' ')}</span>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY[priority] ?? 'bg-zinc-100 text-zinc-600'}`}>{priority}</span>;
}
export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const hrs = (minutes: number): string => `${(minutes / 60).toFixed(1)}h`;
