import {
  type LucideIcon,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  Factory,
  FolderKanban,
  LayoutDashboard,
  ScanLine,
  Settings,
  Sparkles,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';

/** Maps a feature-module key (ADR-009) to its nav entry. The sidebar only renders modules the tenant
 * has enabled — the per-company feature surface is data-driven. */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const MODULE_NAV: Record<string, NavItem> = {
  hr: { key: 'hr', label: 'Human Resources', href: '/hr', icon: Users },
  finance: { key: 'finance', label: 'Finance', href: '/finance', icon: Wallet },
  assets: { key: 'assets', label: 'Fixed Assets', href: '/assets', icon: Building2 },
  inventory: { key: 'inventory', label: 'Inventory', href: '/inventory', icon: Warehouse },
  production: { key: 'production', label: 'Manufacturing', href: '/production', icon: Factory },
  pos: { key: 'pos', label: 'Point of Sale', href: '/pos', icon: ScanLine },
  crm: { key: 'crm', label: 'CRM', href: '/crm', icon: Boxes },
  projects: { key: 'projects', label: 'Projects', href: '/projects', icon: FolderKanban },
  reporting: { key: 'reporting', label: 'Reporting', href: '/reporting', icon: BarChart3 },
  ai: { key: 'ai', label: 'AI Insights', href: '/ai', icon: Sparkles },
  notifications: { key: 'notifications', label: 'Notifications', href: '/notifications', icon: Bell },
};

export const DASHBOARD_ITEM: NavItem = { key: 'dashboard', label: 'Dashboard', href: '/', icon: LayoutDashboard };
export const SETTINGS_ITEM: NavItem = { key: 'settings', label: 'Settings', href: '/settings/features', icon: Settings };

export interface FeatureModule {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  features: { key: string; name: string; enabled: boolean }[];
}
