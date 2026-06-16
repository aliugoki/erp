'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, CalendarDays, Target, Users, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/hr', label: 'Employees', icon: Users, exact: true },
  { href: '/hr/leave', label: 'Leave', icon: CalendarDays, exact: false },
  { href: '/hr/payroll', label: 'Payroll', icon: Wallet, exact: false },
  { href: '/hr/performance', label: 'Performance', icon: Target, exact: false },
  { href: '/hr/reports', label: 'HR Reports', icon: BarChart3, exact: false },
];

/** Sub-navigation across the HR sub-pages. */
export function HrTabs() {
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
