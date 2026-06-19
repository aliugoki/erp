'use client';
import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Reusable three-pane workspace (rail → list → detail), the email-client pattern. Each pane scrolls
 * independently and fills the available height; selection is in-place (no route change) so it stays fast.
 * On large screens all three panes show; below `lg` the list and detail swap (driven by `showDetail`),
 * the rail collapses into the list header. Designed to be the standard module shell across the app.
 */
export function ThreePane({ rail, list, detail, showDetail }: { rail: ReactNode; list: ReactNode; detail: ReactNode; showDetail?: boolean }) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/20 lg:flex">{rail}</aside>
      <section className={cn('min-h-0 w-full flex-col border-r lg:flex lg:w-[360px] lg:shrink-0', showDetail ? 'hidden lg:flex' : 'flex')}>{list}</section>
      <section className={cn('min-h-0 flex-1 flex-col bg-background', showDetail ? 'flex' : 'hidden lg:flex')}>{detail}</section>
    </div>
  );
}

/** A vertical pane: sticky header + independently scrolling body. */
export function Pane({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 flex-1 flex-col', className)}>{children}</div>;
}

export function PaneHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5', className)}>{children}</div>;
}

export function PaneBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>;
}

const RAIL_TONE: Record<string, string> = {
  default: 'text-primary',
  emerald: 'text-emerald-600',
  sky: 'text-sky-600',
  amber: 'text-amber-600',
  violet: 'text-violet-600',
  rose: 'text-rose-600',
};

/** A section entry in the rail with an icon + optional count badge. */
export function RailItem({ icon: Icon, label, count, active, onClick, tone = 'default' }: { icon: LucideIcon; label: string; count?: number; active?: boolean; onClick?: () => void; tone?: keyof typeof RAIL_TONE }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
        active ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? RAIL_TONE[tone] : 'text-muted-foreground group-hover:text-foreground')} />
      <span className="flex-1 text-left">{label}</span>
      {count != null ? <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', active ? 'bg-muted text-foreground' : 'bg-muted/70 text-muted-foreground')}>{count}</span> : null}
    </button>
  );
}

/** A friendly empty state for the detail pane when nothing is selected. */
export function EmptyDetail({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-10 text-center">
      <div className="mb-3 rounded-2xl bg-muted/50 p-4"><Icon className="h-7 w-7 text-muted-foreground" /></div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A selectable row in the list pane (left accent + active highlight). */
export function ListRow({ active, onClick, children, accent }: { active?: boolean; onClick?: () => void; children: ReactNode; accent?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left text-sm transition',
        active ? 'border-l-primary bg-muted/60' : 'border-l-transparent hover:bg-muted/30',
        accent,
      )}
    >
      {children}
    </button>
  );
}
