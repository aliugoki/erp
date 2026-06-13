'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CalendarRange, FileText, Landmark, ListTree, NotebookPen, PieChart } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/finance', label: 'Invoices', icon: FileText, exact: true },
  { href: '/finance/accounts', label: 'Chart of Accounts', icon: ListTree, exact: false },
  { href: '/finance/journal', label: 'Journal', icon: NotebookPen, exact: false },
  { href: '/finance/ledger', label: 'General Ledger', icon: BookOpen, exact: false },
  { href: '/finance/cash-book', label: 'Cash & Bank', icon: Landmark, exact: false },
  { href: '/finance/reports', label: 'Reports', icon: PieChart, exact: false },
  { href: '/finance/periods', label: 'Periods', icon: CalendarRange, exact: false },
];

/** Sub-navigation across the finance sub-pages (invoices, COA, journal, ledger, statements). */
export function FinanceTabs() {
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
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
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
