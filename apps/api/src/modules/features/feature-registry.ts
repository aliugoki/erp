/**
 * Static feature catalog (ADR-009). The single source of truth for "what features exist". Tenants
 * enable/disable these keys (stored in `tenant_feature_entitlement`); the backend FeatureGuard and
 * the web nav both read from here. Keys are `module` or `module.subfeature`.
 */
export interface FeatureDef {
  key: string;
  name: string;
}

export interface FeatureModuleDef {
  /** Module key, e.g. "finance". Enabling the module enables this key. */
  key: string;
  name: string;
  description: string;
  /** Other module keys this one needs (enforced when toggling). */
  dependsOn?: string[];
  /** Fine-grained sub-features, keyed `module.subfeature`. */
  features: FeatureDef[];
}

export const FEATURE_MODULES: FeatureModuleDef[] = [
  {
    key: 'hr',
    name: 'Human Resources',
    description: 'Employees, departments, positions, attendance.',
    features: [
      { key: 'hr.employees', name: 'Employees' },
      { key: 'hr.departments', name: 'Departments' },
      { key: 'hr.attendance', name: 'Attendance' },
    ],
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Chart of accounts, transactions, invoicing.',
    features: [
      { key: 'finance.invoicing', name: 'Invoicing' },
      { key: 'finance.double_entry', name: 'Double-entry ledger' },
      { key: 'finance.reports', name: 'Financial reports' },
    ],
  },
  {
    key: 'inventory',
    name: 'Inventory',
    description: 'Products, warehouses, stock movements.',
    features: [
      { key: 'inventory.products', name: 'Products' },
      { key: 'inventory.categories', name: 'Categories' },
      { key: 'inventory.warehouses', name: 'Warehouses' },
      { key: 'inventory.low_stock', name: 'Low-stock alerts' },
    ],
  },
  {
    key: 'crm',
    name: 'CRM',
    description: 'Clients, contacts, deals, pipeline.',
    features: [
      { key: 'crm.contacts', name: 'Contacts' },
      { key: 'crm.deals', name: 'Deals' },
      { key: 'crm.pipeline', name: 'Pipeline' },
    ],
  },
  {
    key: 'reporting',
    name: 'Reporting',
    description: 'Cross-module dashboards and reports.',
    dependsOn: [],
    features: [{ key: 'reporting.dashboards', name: 'Dashboards' }],
  },
  {
    key: 'notifications',
    name: 'Notifications',
    description: 'Email and in-app notifications.',
    features: [
      { key: 'notifications.email', name: 'Email' },
      { key: 'notifications.in_app', name: 'In-app' },
    ],
  },
];

/** Every valid feature key (module keys + sub-feature keys). */
export const ALL_FEATURE_KEYS: Set<string> = new Set(
  FEATURE_MODULES.flatMap((m) => [m.key, ...m.features.map((f) => f.key)]),
);

/** Map a sub-feature key back to its module key (or itself if it is a module). */
export function moduleKeyOf(featureKey: string): string {
  return featureKey.includes('.') ? featureKey.split('.')[0]! : featureKey;
}

export type PlanTemplate = 'starter' | 'business' | 'enterprise';

const STARTER = ['hr', 'hr.employees', 'crm', 'crm.contacts', 'notifications', 'notifications.in_app'];

const BUSINESS = [
  ...STARTER,
  'hr.departments',
  'hr.attendance',
  'finance',
  'finance.invoicing',
  'finance.reports',
  'inventory',
  'inventory.products',
  'inventory.categories',
  'inventory.low_stock',
  'crm.deals',
  'crm.pipeline',
  'reporting',
  'reporting.dashboards',
  'notifications.email',
];

/** Default feature sets applied at tenant provisioning. */
export const PLAN_TEMPLATES: Record<PlanTemplate, string[]> = {
  starter: STARTER,
  business: BUSINESS,
  enterprise: [...ALL_FEATURE_KEYS],
};
