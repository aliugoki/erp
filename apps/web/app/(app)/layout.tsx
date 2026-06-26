'use client';
import { type ReactNode, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

function titleFor(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  if (pathname.startsWith('/platform/companies')) return 'Platform · Companies';
  if (pathname.startsWith('/settings/users')) return 'Settings · Users';
  if (pathname.startsWith('/settings/roles')) return 'Settings · Roles';
  if (pathname.startsWith('/settings/policies')) return 'Settings · Policies';
  if (pathname.startsWith('/settings')) return 'Settings · Features';
  if (pathname.startsWith('/crm')) return 'CRM';
  if (pathname.startsWith('/hr')) return 'Human Resources';
  if (pathname.startsWith('/finance')) return 'Finance';
  if (pathname.startsWith('/inventory')) return 'Inventory';
  if (pathname.startsWith('/pos')) return 'Point of Sale';
  if (pathname.startsWith('/production')) return 'Manufacturing';
  if (pathname.startsWith('/assets')) return 'Fixed Assets';
  if (pathname.startsWith('/projects')) return 'Projects';
  if (pathname.startsWith('/ecommerce')) return 'Online Store';
  if (pathname.startsWith('/helpdesk')) return 'Help Desk';
  return 'MetaXperts ERP';
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="ambient flex flex-1 flex-col overflow-hidden">
        <Topbar title={titleFor(pathname)} />
        <main className="relative z-10 flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
