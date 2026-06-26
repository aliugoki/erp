'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Boxes, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ANALYTICS_ITEM, COMPANIES_ITEM, DASHBOARD_ITEM, type FeatureModule, MODULE_NAV, type NavItem, SETTINGS_ITEM } from '@/lib/nav';
import { cn } from '@/lib/utils';

const STORE_KEY = 'mx_sidebar_collapsed';

function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-all duration-200',
        collapsed ? 'justify-center px-0' : 'px-3',
        active
          ? 'bg-sidebar-accent/90 text-white shadow-[0_0_24px_-6px_hsl(var(--sidebar-accent))]'
          : 'text-sidebar-foreground/65 hover:bg-white/[0.06] hover:text-sidebar-foreground',
      )}
    >
      {active && !collapsed ? (
        <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-accent shadow-[0_0_12px_hsl(var(--sidebar-accent))]" />
      ) : null}
      <Icon className={cn('size-4 shrink-0 transition-transform group-hover:scale-110', active && 'drop-shadow')} />
      {collapsed ? null : item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem(STORE_KEY) === '1'); }, []);
  const toggle = () => setCollapsed((c) => { const n = !c; localStorage.setItem(STORE_KEY, n ? '1' : '0'); return n; });

  const { user } = useAuth();
  const isSuperAdmin = (user?.roles ?? []).includes('SUPER_ADMIN');

  const { data: modules } = useQuery({
    queryKey: ['features'],
    queryFn: () => apiGet<FeatureModule[]>('/tenant/features'),
  });
  const enabledModules = (modules ?? []).filter((m) => m.enabled);
  const reportingOn = enabledModules.some((m) => m.key === 'reporting');

  const SectionLabel = ({ children }: { children: string }) =>
    collapsed ? (
      <div className="mx-2 my-2 border-t border-sidebar-border/60" />
    ) : (
      <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">{children}</p>
    );

  return (
    <aside
      className={cn(
        'relative hidden shrink-0 flex-col bg-gradient-to-b from-sidebar to-sidebar/95 text-sidebar-foreground transition-[width] duration-200 md:flex',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="pointer-events-none absolute -left-10 top-10 size-40 rounded-full bg-sidebar-accent opacity-15 blur-3xl" />
      <div className={cn('relative flex h-16 items-center gap-2.5 border-b border-sidebar-border', collapsed ? 'justify-center px-0' : 'px-5')}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-white shadow-[0_0_18px_-2px_hsl(var(--sidebar-accent))]">
          <Boxes className="size-5" />
        </div>
        {collapsed ? null : <span className="text-lg font-semibold tracking-tight">MetaXperts</span>}
        {collapsed ? null : (
          <button type="button" onClick={toggle} title="Collapse menu" className="ml-auto rounded-md p-1.5 text-sidebar-foreground/50 transition hover:bg-white/[0.06] hover:text-sidebar-foreground">
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      <nav className="relative flex-1 space-y-1 overflow-y-auto p-3">
        <NavLink item={DASHBOARD_ITEM} active={pathname === '/'} collapsed={collapsed} />
        {reportingOn ? <NavLink item={ANALYTICS_ITEM} active={pathname.startsWith('/analytics')} collapsed={collapsed} /> : null}

        <SectionLabel>Modules</SectionLabel>
        {enabledModules.length === 0 ? (
          collapsed ? null : <p className="px-3 py-2 text-xs text-sidebar-foreground/40">No modules enabled</p>
        ) : (
          enabledModules
            .map((m) => MODULE_NAV[m.key])
            .filter((i): i is NavItem => Boolean(i))
            .map((item) => <NavLink key={item.key} item={item} active={pathname.startsWith(item.href)} collapsed={collapsed} />)
        )}

        {isSuperAdmin ? (
          <>
            <SectionLabel>Platform</SectionLabel>
            <NavLink item={COMPANIES_ITEM} active={pathname.startsWith('/platform')} collapsed={collapsed} />
          </>
        ) : null}

        <SectionLabel>Admin</SectionLabel>
        <NavLink item={SETTINGS_ITEM} active={pathname.startsWith('/settings')} collapsed={collapsed} />
      </nav>

      <div className={cn('relative border-t border-sidebar-border', collapsed ? 'p-2' : 'p-3')}>
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg py-2 text-xs font-medium text-sidebar-foreground/55 transition hover:bg-white/[0.06] hover:text-sidebar-foreground',
            collapsed ? 'justify-center px-0' : 'px-3',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}
