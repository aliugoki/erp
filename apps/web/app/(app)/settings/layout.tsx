'use client';
import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/settings/features', label: 'Features', adminOnly: false },
  { href: '/settings/users', label: 'Users', adminOnly: true },
  { href: '/settings/roles', label: 'Roles', adminOnly: true },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = (user?.roles ?? []).some((r) => r === 'TENANT_ADMIN' || r === 'SUPER_ADMIN');
  const tabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
      <div className="flex gap-1 border-b">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + '/');
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
