'use client';
import { type LucideIcon, CheckSquare, Mail, Phone, StickyNote, Users } from 'lucide-react';

const STAGE_TONE: Record<string, string> = {
  LEAD: 'bg-zinc-100 text-zinc-600',
  QUALIFIED: 'bg-sky-100 text-sky-700',
  PROPOSAL: 'bg-violet-100 text-violet-700',
  NEGOTIATION: 'bg-amber-100 text-amber-700',
  CLOSED_WON: 'bg-emerald-100 text-emerald-700',
  CLOSED_LOST: 'bg-rose-100 text-rose-700',
};
const LEAD_TONE: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-700',
  CONTACTED: 'bg-indigo-100 text-indigo-700',
  QUALIFIED: 'bg-violet-100 text-violet-700',
  UNQUALIFIED: 'bg-zinc-100 text-zinc-500',
  CONVERTED: 'bg-emerald-100 text-emerald-700',
};
const RATING_TONE: Record<string, string> = {
  HOT: 'bg-rose-100 text-rose-700',
  WARM: 'bg-amber-100 text-amber-700',
  COLD: 'bg-sky-100 text-sky-700',
};
const ACCOUNT_TONE: Record<string, string> = {
  PROSPECT: 'bg-sky-100 text-sky-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INACTIVE: 'bg-zinc-100 text-zinc-500',
};

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}

export const StageBadge = ({ stage }: { stage: string }) => <Badge tone={STAGE_TONE[stage] ?? 'bg-zinc-100 text-zinc-600'}>{stage.replace('_', ' ')}</Badge>;
export const LeadStatusBadge = ({ status }: { status: string }) => <Badge tone={LEAD_TONE[status] ?? 'bg-zinc-100 text-zinc-600'}>{status}</Badge>;
export const RatingBadge = ({ rating }: { rating: string }) => <Badge tone={RATING_TONE[rating] ?? 'bg-zinc-100 text-zinc-600'}>{rating}</Badge>;
export const AccountStatusBadge = ({ status }: { status: string }) => <Badge tone={ACCOUNT_TONE[status] ?? 'bg-zinc-100 text-zinc-600'}>{status}</Badge>;

export const ACTIVITY_META: Record<string, { icon: LucideIcon; tone: string }> = {
  CALL: { icon: Phone, tone: 'text-sky-600' },
  MEETING: { icon: Users, tone: 'text-violet-600' },
  EMAIL: { icon: Mail, tone: 'text-amber-600' },
  TASK: { icon: CheckSquare, tone: 'text-emerald-600' },
  NOTE: { icon: StickyNote, tone: 'text-zinc-500' },
};

export const STAGES = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED'];
export const RATINGS = ['HOT', 'WARM', 'COLD'];

export const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export function dueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  return { text: Math.abs(days) >= 1 ? (days > 0 ? `in ${days}d` : `${-days}d ago`) : (ms >= 0 ? 'today' : 'overdue'), overdue: ms < 0 };
}
