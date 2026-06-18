'use client';
import { AlertTriangle, PauseCircle } from 'lucide-react';
import type { HdTicket } from '@/lib/types';

const STATUS_TONE: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-700',
  OPEN: 'bg-indigo-100 text-indigo-700',
  PENDING: 'bg-amber-100 text-amber-700',
  ON_HOLD: 'bg-zinc-200 text-zinc-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-zinc-100 text-zinc-500',
};
const PRIORITY_TONE: Record<string, string> = {
  LOW: 'bg-zinc-100 text-zinc-600',
  MEDIUM: 'bg-sky-100 text-sky-700',
  HIGH: 'bg-amber-100 text-amber-700',
  URGENT: 'bg-rose-100 text-rose-700',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] ?? 'bg-zinc-100 text-zinc-600'}`}>{status.replace('_', ' ')}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PRIORITY_TONE[priority] ?? 'bg-zinc-100 text-zinc-600'}`}>
      {priority === 'URGENT' ? <AlertTriangle className="h-3 w-3" /> : null}{priority}
    </span>
  );
}

/** Human "in 2h 10m" / "3h overdue" for an SLA due timestamp. */
export function dueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const overdue = ms < 0;
  const mins = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { text: overdue ? `${span} overdue` : `in ${span}`, overdue };
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

/** The most relevant SLA indicator for a ticket (first-response, then resolution). */
export function SlaPill({ ticket }: { ticket: HdTicket }) {
  if (['RESOLVED', 'CLOSED'].includes(ticket.status)) return null;
  if (ticket.firstResponseBreached || ticket.resolutionBreached) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" /> SLA breached</span>;
  }
  if (ticket.slaPaused) return <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500"><PauseCircle className="h-3 w-3" /> SLA paused</span>;
  const target = !ticket.firstRespondedAt ? ticket.firstResponseDueAt : ticket.resolutionDueAt;
  const label = !ticket.firstRespondedAt ? 'Response' : 'Resolution';
  const d = dueLabel(target);
  if (!d) return null;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${d.overdue ? 'bg-rose-100 text-rose-700' : 'bg-zinc-100 text-zinc-600'}`}>{label} {d.text}</span>;
}
