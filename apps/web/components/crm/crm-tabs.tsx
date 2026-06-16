'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BarChart3, Building2, KanbanSquare, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/crm', label: 'Pipeline', icon: KanbanSquare, exact: true },
  { href: '/crm/leads', label: 'Leads', icon: UserPlus, exact: false },
  { href: '/crm/accounts', label: 'Accounts', icon: Building2, exact: false },
  { href: '/crm/activities', label: 'Activities', icon: Activity, exact: false },
  { href: '/crm/reports', label: 'Sales Reports', icon: BarChart3, exact: false },
];

/** Sub-navigation across the CRM sub-pages. */
export function CrmTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
