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
    description: 'Employees, departments, leave, payroll, performance, HR reports.',
    features: [
      { key: 'hr.employees', name: 'Employees' },
      { key: 'hr.departments', name: 'Departments' },
      { key: 'hr.attendance', name: 'Attendance' },
      { key: 'hr.leave', name: 'Leave management' },
      { key: 'hr.payroll', name: 'Payroll' },
      { key: 'hr.performance', name: 'Performance' },
      { key: 'hr.policies', name: 'Policies' },
      { key: 'hr.reports', name: 'HR reports' },
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
    key: 'sales',
    name: 'Sales',
    description: 'Quotations and sales orders (quote-to-order).',
    features: [
      { key: 'sales.quotations', name: 'Quotations' },
      { key: 'sales.orders', name: 'Sales orders' },
    ],
  },
  {
    key: 'pos',
    name: 'Point of Sale',
    description: 'Retail counter: registers, cashier shifts, sales, returns, and POS reports.',
    dependsOn: ['inventory'],
    features: [
      { key: 'pos.registers', name: 'Registers' },
      { key: 'pos.shifts', name: 'Cashier shifts' },
      { key: 'pos.sales', name: 'Sales & returns' },
      { key: 'pos.reports', name: 'POS reports' },
    ],
  },
  {
    key: 'pharmacy',
    name: 'Pharmacy',
    description: 'Configurable pharmacy (retail/hospital/wholesale): drug master, batch+expiry (FEFO) stock, dispensing, controlled-substance register, and GL/inventory/POS integration.',
    dependsOn: ['inventory', 'finance'],
    features: [
      { key: 'pharmacy.drugs', name: 'Drug master' },
      { key: 'pharmacy.batches', name: 'Batch & expiry (FEFO)' },
      { key: 'pharmacy.dispensing', name: 'Dispensing & sales' },
      { key: 'pharmacy.controlled', name: 'Controlled-substance register' },
      { key: 'pharmacy.reports', name: 'Pharmacy reports' },
    ],
  },
  {
    key: 'production',
    name: 'Manufacturing',
    description: 'Bills of materials, work centers, production orders, and costing.',
    dependsOn: ['inventory'],
    features: [
      { key: 'production.boms', name: 'Bills of materials' },
      { key: 'production.workcenters', name: 'Work centers' },
      { key: 'production.orders', name: 'Production orders' },
      { key: 'production.attributes', name: 'Custom attributes' },
    ],
  },
  {
    key: 'assets',
    name: 'Fixed Assets',
    description: 'Asset register, depreciation runs, disposal, and maintenance.',
    features: [
      { key: 'assets.register', name: 'Asset register' },
      { key: 'assets.depreciation', name: 'Depreciation' },
      { key: 'assets.maintenance', name: 'Maintenance' },
    ],
  },
  {
    key: 'projects',
    name: 'Projects',
    description: 'Projects, tasks, timesheets, and project costing.',
    features: [
      { key: 'projects.tasks', name: 'Tasks' },
      { key: 'projects.timesheets', name: 'Timesheets' },
      { key: 'projects.costing', name: 'Costing' },
    ],
  },
  {
    key: 'ecommerce',
    name: 'Online Store',
    description: 'Shopify-style storefront: catalogue, collections, cart, checkout, online orders.',
    dependsOn: ['inventory'],
    features: [
      { key: 'ecommerce.storefront', name: 'Storefront' },
      { key: 'ecommerce.catalog', name: 'Catalogue & collections' },
      { key: 'ecommerce.orders', name: 'Online orders' },
      { key: 'ecommerce.discounts', name: 'Discount codes' },
    ],
  },
  {
    key: 'subscriptions',
    name: 'Subscriptions',
    description: 'Recurring billing: plans, subscriptions, automatic invoicing, dunning, and MRR/ARR.',
    dependsOn: ['finance'],
    features: [
      { key: 'subscriptions.plans', name: 'Plans' },
      { key: 'subscriptions.billing', name: 'Recurring billing' },
      { key: 'subscriptions.invoices', name: 'Invoices' },
      { key: 'subscriptions.portal', name: 'Customer portal' },
    ],
  },
  {
    key: 'helpdesk',
    name: 'Help Desk',
    description: 'Customer support tickets with an SLA engine, agent/team assignment, and a support portal.',
    features: [
      { key: 'helpdesk.tickets', name: 'Tickets' },
      { key: 'helpdesk.sla', name: 'SLA policies' },
      { key: 'helpdesk.teams', name: 'Teams' },
      { key: 'helpdesk.portal', name: 'Customer portal' },
    ],
  },
  {
    key: 'crm',
    name: 'CRM',
    description: 'Accounts, contacts, leads, opportunities, activities, sales reports.',
    features: [
      { key: 'crm.contacts', name: 'Contacts' },
      { key: 'crm.deals', name: 'Deals' },
      { key: 'crm.pipeline', name: 'Pipeline' },
      { key: 'crm.leads', name: 'Leads' },
      { key: 'crm.activities', name: 'Activities' },
      { key: 'crm.reports', name: 'Sales reports' },
    ],
  },
  {
    key: 'reporting',
    name: 'Reporting',
    description: 'Cross-module dashboards, preset and custom reports.',
    dependsOn: [],
    features: [
      { key: 'reporting.dashboards', name: 'Dashboards' },
      { key: 'reporting.custom', name: 'Custom report builder' },
    ],
  },
  {
    key: 'ai',
    name: 'AI Insights',
    description: 'ML-powered forecasting, scoring and anomaly detection across modules.',
    features: [
      { key: 'ai.forecasting', name: 'Forecasting' },
      { key: 'ai.scoring', name: 'Lead & attrition scoring' },
      { key: 'ai.anomalies', name: 'Anomaly detection' },
    ],
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
  'hr.leave',
  'hr.payroll',
  'hr.performance',
  'hr.policies',
  'hr.reports',
  'finance',
  'finance.invoicing',
  'finance.reports',
  'inventory',
  'inventory.products',
  'inventory.categories',
  'inventory.low_stock',
  'crm.deals',
  'crm.pipeline',
  'sales',
  'sales.quotations',
  'sales.orders',
  'pos',
  'pos.registers',
  'pos.shifts',
  'pos.sales',
  'pos.reports',
  'pharmacy',
  'pharmacy.drugs',
  'pharmacy.batches',
  'pharmacy.dispensing',
  'pharmacy.controlled',
  'pharmacy.reports',
  'production',
  'production.boms',
  'production.workcenters',
  'production.orders',
  'production.attributes',
  'assets',
  'assets.register',
  'assets.depreciation',
  'assets.maintenance',
  'projects',
  'projects.tasks',
  'projects.timesheets',
  'projects.costing',
  'crm.leads',
  'crm.activities',
  'crm.reports',
  'ecommerce',
  'ecommerce.storefront',
  'ecommerce.catalog',
  'ecommerce.orders',
  'ecommerce.discounts',
  'helpdesk',
  'helpdesk.tickets',
  'helpdesk.sla',
  'helpdesk.teams',
  'helpdesk.portal',
  'subscriptions',
  'subscriptions.plans',
  'subscriptions.billing',
  'subscriptions.invoices',
  'subscriptions.portal',
  'reporting',
  'reporting.dashboards',
  'reporting.custom',
  'ai',
  'ai.forecasting',
  'ai.scoring',
  'ai.anomalies',
  'notifications.email',
];

/** Default feature sets applied at tenant provisioning. */
export const PLAN_TEMPLATES: Record<PlanTemplate, string[]> = {
  starter: STARTER,
  business: BUSINESS,
  enterprise: [...ALL_FEATURE_KEYS],
};
