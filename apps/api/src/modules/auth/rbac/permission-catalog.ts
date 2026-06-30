/**
 * The permission catalog (Path 2, Phase A) — the single source of truth for fine-grained permissions,
 * formatted `domain:resource:action`. Grouped by module for the role-builder UI and surfaced via
 * `GET /tenant/roles/permissions`.
 *
 * Phase A seeds the catalog from the permissions the built-in capability roles already grant (see
 * ROLE_PERMISSIONS). It GROWS in Phase B as each module's endpoints are tagged with `@ShadowPermissions`
 * and a matching catalog entry — the catalog and the per-endpoint tags are kept in lockstep, and a
 * unit test asserts every catalog permission is granted by at least one role and vice-versa.
 */
export interface PermissionDef {
  key: string;
  label: string;
}

export interface PermissionGroup {
  domain: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_CATALOG: PermissionGroup[] = [
  {
    domain: 'hr',
    label: 'Human Resources',
    permissions: [
      { key: 'hr:employee:read', label: 'View employees' },
      { key: 'hr:employee:write', label: 'Create / edit employees' },
      { key: 'hr:department:write', label: 'Manage departments' },
      { key: 'hr:org:write', label: 'Manage positions & designations' },
      { key: 'hr:attendance:write', label: 'Record attendance' },
      { key: 'hr:leave:write', label: 'Manage leave (types, balances, requests)' },
      { key: 'hr:payroll:write', label: 'Run payroll & salary components' },
      { key: 'hr:performance:write', label: 'Manage reviews & goals' },
      { key: 'hr:lifecycle:write', label: 'Employee lifecycle events' },
      { key: 'hr:document:write', label: 'Manage HR documents' },
      { key: 'hr:policy:write', label: 'Manage HR policies & custom fields' },
      { key: 'hr:profile:write', label: 'Edit employee profiles (education, experience)' },
    ],
  },
  {
    domain: 'finance',
    label: 'Finance',
    permissions: [
      { key: 'finance:invoice:read', label: 'View invoices' },
      { key: 'finance:invoice:write', label: 'Create / edit invoices' },
      { key: 'finance:voucher:write', label: 'Create / edit vouchers & recurring templates' },
      { key: 'finance:voucher:post', label: 'Post / reverse / run vouchers' },
      { key: 'finance:account:write', label: 'Manage chart of accounts' },
      { key: 'finance:bill:write', label: 'Manage vendor bills (AP)' },
      { key: 'finance:payment:write', label: 'Record payments' },
      { key: 'finance:vendor:write', label: 'Manage vendors' },
      { key: 'finance:customer:write', label: 'Manage customers' },
      { key: 'finance:period:write', label: 'Manage fiscal periods & year-end close' },
      { key: 'finance:reconciliation:write', label: 'Bank reconciliation & statements' },
      { key: 'finance:costcenter:write', label: 'Manage cost centres' },
      { key: 'finance:budget:write', label: 'Manage budgets' },
      { key: 'finance:currency:write', label: 'Manage currencies & exchange rates' },
    ],
  },
  {
    domain: 'inventory',
    label: 'Inventory',
    permissions: [
      { key: 'inventory:product:read', label: 'View products' },
      { key: 'inventory:product:write', label: 'Create / edit products & images' },
      { key: 'inventory:stock:write', label: 'Record stock movements' },
      { key: 'inventory:category:write', label: 'Manage categories' },
      { key: 'inventory:warehouse:write', label: 'Manage warehouses' },
    ],
  },
  {
    domain: 'crm',
    label: 'CRM',
    permissions: [
      { key: 'crm:deal:read', label: 'View deals' },
      { key: 'crm:deal:write', label: 'Create / edit deals' },
      { key: 'crm:contact:write', label: 'Manage contacts' },
      { key: 'crm:account:write', label: 'Manage accounts / clients' },
      { key: 'crm:lead:write', label: 'Manage leads & conversion' },
      { key: 'crm:activity:write', label: 'Manage activities' },
    ],
  },
  {
    domain: 'sales',
    label: 'Sales',
    permissions: [
      { key: 'sales:quotation:write', label: 'Manage quotations' },
      { key: 'sales:order:write', label: 'Manage sales orders' },
    ],
  },
  {
    domain: 'helpdesk',
    label: 'Help Desk',
    permissions: [
      { key: 'helpdesk:ticket:read', label: 'View tickets' },
      { key: 'helpdesk:ticket:write', label: 'Work tickets' },
      { key: 'helpdesk:config:write', label: 'Configure teams & SLA policies (admin)' },
    ],
  },
  {
    domain: 'pos',
    label: 'Point of Sale',
    permissions: [
      { key: 'pos:sale:write', label: 'Operate POS (registers, shifts, sales, returns)' },
      { key: 'pos:report:read', label: 'View POS analytics' },
      { key: 'pos:glconfig:write', label: 'Configure POS GL mapping' },
      { key: 'pos:config:write', label: 'POS administration (admin)' },
    ],
  },
  {
    domain: 'projects',
    label: 'Projects',
    permissions: [{ key: 'project:write', label: 'Manage projects, tasks, timesheets & expenses' }],
  },
  {
    domain: 'assets',
    label: 'Fixed Assets',
    permissions: [{ key: 'asset:write', label: 'Manage assets, depreciation, disposal & maintenance' }],
  },
  {
    domain: 'production',
    label: 'Manufacturing',
    permissions: [
      { key: 'production:write', label: 'Manage BOMs & work orders' },
      { key: 'production:glconfig:read', label: 'View production GL mapping' },
      { key: 'production:glconfig:write', label: 'Configure production GL mapping' },
    ],
  },
  {
    domain: 'pharmacy',
    label: 'Pharmacy',
    permissions: [
      { key: 'pharmacy:operate', label: 'Operate pharmacy (dispense, receive, adjust)' },
      { key: 'pharmacy:config', label: 'Pharmacy administration & GL config (admin)' },
    ],
  },
  {
    domain: 'ecommerce',
    label: 'Online Store',
    permissions: [
      { key: 'ecommerce:manage', label: 'Manage store, products & orders (admin)' },
      { key: 'ecommerce:finance:write', label: 'Store financial actions (refunds, payments)' },
    ],
  },
  {
    domain: 'subscriptions',
    label: 'Subscriptions',
    permissions: [{ key: 'subscription:write', label: 'Manage plans, billing & dunning' }],
  },
  {
    domain: 'reporting',
    label: 'Reporting',
    permissions: [{ key: 'report:write', label: 'Refresh report read-models (admin)' }],
  },
  {
    domain: 'branch',
    label: 'Branches',
    permissions: [{ key: 'branch:write', label: 'Manage company branches' }],
  },
];

/** Flat list of every catalog permission key. */
export const ALL_PERMISSIONS: string[] = PERMISSION_CATALOG.flatMap((g) => g.permissions.map((p) => p.key));

/** Set form for O(1) membership checks (validation). */
export const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);
