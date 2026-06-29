import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Page heading. Shows a module-tinted icon chip (or a gradient accent bar) so each module's pages
 * read sharp and on-theme — the `--primary` accent is re-tinted per module by the app shell. */
export function PageHeader({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {Icon ? (
          <span className="gloss flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 shadow-[0_4px_16px_-6px_hsl(var(--glow)/0.55)]">
            <Icon className="size-5" />
          </span>
        ) : (
          <span className="h-9 w-1.5 rounded-full bg-gradient-to-b from-primary to-primary/30" />
        )}
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-gradient">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
