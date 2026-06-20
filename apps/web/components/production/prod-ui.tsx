'use client';

const TONE: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-600',
  PLANNED: 'bg-sky-100 text-sky-700',
  RELEASED: 'bg-indigo-100 text-indigo-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  ARCHIVED: 'bg-zinc-200 text-zinc-600',
  INACTIVE: 'bg-zinc-100 text-zinc-500',
};
const PRIORITY: Record<string, string> = {
  LOW: 'bg-zinc-100 text-zinc-500',
  NORMAL: 'bg-sky-100 text-sky-700',
  HIGH: 'bg-amber-100 text-amber-700',
  URGENT: 'bg-rose-100 text-rose-700',
};

export function ProdBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status.replace(/_/g, ' ')}</span>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY[priority] ?? 'bg-zinc-100 text-zinc-600'}`}>{priority}</span>;
}
export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
