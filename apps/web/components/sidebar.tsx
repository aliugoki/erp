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
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-white'
          : 'text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
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
    <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-white">
          <Boxes className="size-5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">MetaXperts</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
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

      <div className="border-t border-sidebar-border p-4 text-xs text-sidebar-foreground/40">
        Per-company features · ADR-009
      </div>
    </aside>
  );
}
