'use client';

const TONE: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-600',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  DISPOSED: 'bg-amber-100 text-amber-700',
  WRITTEN_OFF: 'bg-rose-100 text-rose-700',
  INACTIVE: 'bg-zinc-100 text-zinc-500',
  POSTED: 'bg-emerald-100 text-emerald-700',
};
const METHOD_LABEL: Record<string, string> = {
  STRAIGHT_LINE: 'Straight line',
  DECLINING_BALANCE: 'Declining balance',
  NONE: 'No depreciation',
};

export function AssetBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status.replace(/_/g, ' ')}</span>;
}
export const methodLabel = (m: string): string => METHOD_LABEL[m] ?? m;
export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
