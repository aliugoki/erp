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
    ],
  },
  {
    domain: 'finance',
    label: 'Finance',
    permissions: [
      { key: 'finance:invoice:read', label: 'View invoices' },
      { key: 'finance:invoice:write', label: 'Create / edit invoices' },
      { key: 'finance:transaction:write', label: 'Post transactions & vouchers' },
    ],
  },
  {
    domain: 'inventory',
    label: 'Inventory',
    permissions: [
      { key: 'inventory:product:read', label: 'View products' },
      { key: 'inventory:product:write', label: 'Create / edit products' },
      { key: 'inventory:stock:write', label: 'Adjust stock' },
    ],
  },
  {
    domain: 'crm',
    label: 'CRM',
    permissions: [
      { key: 'crm:deal:read', label: 'View deals' },
      { key: 'crm:deal:write', label: 'Create / edit deals' },
      { key: 'crm:contact:write', label: 'Manage contacts' },
    ],
  },
  {
    domain: 'helpdesk',
    label: 'Help Desk',
    permissions: [
      { key: 'helpdesk:ticket:read', label: 'View tickets' },
      { key: 'helpdesk:ticket:write', label: 'Work tickets' },
    ],
  },
];

/** Flat list of every catalog permission key. */
export const ALL_PERMISSIONS: string[] = PERMISSION_CATALOG.flatMap((g) => g.permissions.map((p) => p.key));

/** Set form for O(1) membership checks (validation). */
export const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);
