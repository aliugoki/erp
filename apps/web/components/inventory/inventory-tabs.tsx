'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, ClipboardList, DoorOpen, FileStack, FolderTree, Package, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/inventory', label: 'Stock', icon: Package, exact: true },
  { href: '/inventory/categories', label: 'Categories', icon: FolderTree, exact: false },
  { href: '/inventory/requisitions', label: 'Requisitions', icon: ClipboardList, exact: false },
  { href: '/inventory/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, exact: false },
  { href: '/inventory/gate-passes', label: 'Gate Passes', icon: DoorOpen, exact: false },
  { href: '/inventory/registers', label: 'Registers', icon: FileStack, exact: false },
  { href: '/inventory/ledger', label: 'Ledger & Reports', icon: BookOpen, exact: false },
];

/** Sub-navigation across the inventory sub-pages. */
export function InventoryTabs() {
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
