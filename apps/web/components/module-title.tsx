'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { MODULE_NAV } from '@/lib/nav';
import { moduleKey } from '@/lib/module-theme';

/**
 * Module page title with a route-derived, module-tinted icon chip. The icon comes from the module's
 * nav entry; the chip colour rides the `--primary` accent that the app shell re-tints per module —
 * so each module's header reads sharp and on-theme with zero per-page wiring.
 */
export function ModuleTitle({ children }: { children: ReactNode }) {
  const nav = MODULE_NAV[moduleKey(usePathname())];
  const Icon = nav?.icon;
  return (
    <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
      {Icon ? (
        <span className="sheen gloss accent-fade flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 shadow-[0_4px_16px_-6px_hsl(var(--glow)/0.55)] transition-transform hover:scale-105">
          <Icon className="size-5" />
        </span>
      ) : null}
      <span className="text-gradient">{children}</span>
    </h1>
  );
}
