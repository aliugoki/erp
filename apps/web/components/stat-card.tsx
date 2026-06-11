'use client';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useCountUp } from '@/lib/use-count-up';
import { cn } from '@/lib/utils';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  /** Render the (count-up) value, e.g. format as money. */
  format?: (v: number) => string;
  hint?: string;
  accent?: 'primary' | 'success' | 'warning' | 'destructive';
  delayMs?: number;
}

const ACCENT: Record<NonNullable<StatCardProps['accent']>, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
};

export function StatCard({ icon: Icon, label, value, format, hint, accent = 'primary', delayMs = 0 }: StatCardProps) {
  const animated = useCountUp(value);
  return (
    <Card
      className="group relative overflow-hidden hover-lift animate-fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-glow opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-20" />
      <div className="flex items-center gap-4 p-5">
        <div className={cn('flex size-11 items-center justify-center rounded-xl', ACCENT[accent])}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-none tabular-nums">{format ? format(animated) : animated}</p>
          <p className="mt-1.5 truncate text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
      {hint ? <p className="px-5 pb-4 text-xs text-muted-foreground/70">{hint}</p> : null}
    </Card>
  );
}
