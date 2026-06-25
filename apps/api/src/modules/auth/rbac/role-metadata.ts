import { Role } from './role.enum';
import { ROLE_PERMISSIONS } from './permissions';

/** Human-facing metadata for the built-in roles, used by the role-builder & user-management UIs. */
export const ROLE_METADATA: Record<Role, { name: string; description: string }> = {
  [Role.SUPER_ADMIN]: { name: 'Platform Super Admin', description: 'Cross-tenant platform operator.' },
  [Role.TENANT_ADMIN]: { name: 'Company Admin', description: 'Full control of this company.' },
  [Role.HR_MANAGER]: { name: 'HR', description: 'Manage employees and departments.' },
  [Role.FINANCE_MANAGER]: { name: 'Finance', description: 'Manage invoices and transactions.' },
  [Role.INVENTORY_MANAGER]: { name: 'Inventory', description: 'Manage products and stock.' },
  [Role.SALES_REP]: { name: 'Sales (CRM)', description: 'Manage deals and contacts.' },
  [Role.SUPPORT_AGENT]: { name: 'Support', description: 'Handle help-desk tickets.' },
  [Role.VIEWER]: { name: 'Viewer', description: 'Read-only access across modules.' },
};

/** The capability roles a company admin may combine into a custom role (no admin roles). */
export const CAPABILITY_ROLES: Role[] = [
  Role.HR_MANAGER,
  Role.FINANCE_MANAGER,
  Role.INVENTORY_MANAGER,
  Role.SALES_REP,
  Role.SUPPORT_AGENT,
  Role.VIEWER,
];

/** Roles a TENANT_ADMIN may assign directly to a user: capabilities + a co-admin, never SUPER_ADMIN. */
export const TENANT_ASSIGNABLE_BUILTIN_ROLES: Role[] = [Role.TENANT_ADMIN, ...CAPABILITY_ROLES];

/** A capability role described for the UI (name, description, the permissions it grants). */
export interface CapabilityInfo {
  key: Role;
  name: string;
  description: string;
  permissions: string[];
}

export function capabilityCatalog(): CapabilityInfo[] {
  return CAPABILITY_ROLES.map((r) => ({
    key: r,
    name: ROLE_METADATA[r].name,
    description: ROLE_METADATA[r].description,
    permissions: ROLE_PERMISSIONS[r] ?? [],
  }));
}
