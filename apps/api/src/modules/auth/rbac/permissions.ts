import { Role } from './role.enum';

/**
 * Fine-grained permissions, formatted `domain:resource:action` (e.g. `finance:invoice:write`).
 * Roles grant sets of permissions; a request's effective permissions are the union over its roles.
 * SUPER_ADMIN / TENANT_ADMIN hold the `*` wildcard (all permissions).
 */
export const WILDCARD = '*';

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  [Role.SUPER_ADMIN]: [WILDCARD],
  [Role.TENANT_ADMIN]: [WILDCARD],
  [Role.HR_MANAGER]: ['hr:employee:read', 'hr:employee:write', 'hr:department:write'],
  [Role.FINANCE_MANAGER]: [
    'finance:invoice:read',
    'finance:invoice:write',
    'finance:transaction:write',
  ],
  [Role.INVENTORY_MANAGER]: ['inventory:product:read', 'inventory:product:write', 'inventory:stock:write'],
  [Role.SALES_REP]: ['crm:deal:read', 'crm:deal:write', 'crm:contact:write'],
  [Role.SUPPORT_AGENT]: ['helpdesk:ticket:read', 'helpdesk:ticket:write'],
  [Role.VIEWER]: [
    'hr:employee:read',
    'finance:invoice:read',
    'inventory:product:read',
    'crm:deal:read',
  ],
};

/** The union of permissions granted by a set of roles. */
export function permissionsForRoles(roles: readonly Role[]): Set<string> {
  const out = new Set<string>();
  for (const role of roles) {
    for (const perm of ROLE_PERMISSIONS[role] ?? []) out.add(perm);
  }
  return out;
}

/** Does this set of roles satisfy a required permission (honoring the `*` wildcard)? */
export function rolesHavePermission(roles: readonly Role[], required: string): boolean {
  const granted = permissionsForRoles(roles);
  return granted.has(WILDCARD) || granted.has(required);
}
