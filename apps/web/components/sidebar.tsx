'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { DASHBOARD_ITEM, type FeatureModule, MODULE_NAV, type NavItem, SETTINGS_ITEM } from '@/lib/nav';
import { cn } from '@/lib/utils';

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
        active
          ? 'bg-sidebar-accent/90 text-white shadow-[0_0_24px_-6px_hsl(var(--sidebar-accent))]'
          : 'text-sidebar-foreground/65 hover:bg-white/[0.06] hover:text-sidebar-foreground',
      )}
    >
      {active ? (
        <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-accent shadow-[0_0_12px_hsl(var(--sidebar-accent))]" />
      ) : null}
      <Icon className={cn('size-4 shrink-0 transition-transform group-hover:scale-110', active && 'drop-shadow')} />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: modules } = useQuery({
    queryKey: ['features'],
    queryFn: () => apiGet<FeatureModule[]>('/tenant/features'),
  });

  const enabledModules = (modules ?? []).filter((m) => m.enabled);

  return (
    <aside className="relative hidden w-64 shrink-0 flex-col bg-gradient-to-b from-sidebar to-sidebar/95 text-sidebar-foreground md:flex">
      <div className="pointer-events-none absolute -left-10 top-10 size-40 rounded-full bg-sidebar-accent opacity-15 blur-3xl" />
      <div className="relative flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-white shadow-[0_0_18px_-2px_hsl(var(--sidebar-accent))]">
          <Boxes className="size-5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">MetaXperts</span>
      </div>

      <nav className="relative flex-1 space-y-1 overflow-y-auto p-3">
        <NavLink item={DASHBOARD_ITEM} active={pathname === '/'} />

        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          Modules
        </p>
        {enabledModules.length === 0 ? (
          <p className="px-3 py-2 text-xs text-sidebar-foreground/40">No modules enabled</p>
        ) : (
          enabledModules
            .map((m) => MODULE_NAV[m.key])
            .filter((i): i is NavItem => Boolean(i))
            .map((item) => <NavLink key={item.key} item={item} active={pathname.startsWith(item.href)} />)
        )}

        <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          Admin
        </p>
        <NavLink item={SETTINGS_ITEM} active={pathname.startsWith('/settings')} />
      </nav>

      <div className="relative border-t border-sidebar-border p-4 text-xs text-sidebar-foreground/40">
        Per-company features · ADR-009
      </div>
    </aside>
  );
}
