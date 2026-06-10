/** Coarse roles assigned to users (ADR-006). Fine-grained access is expressed as permissions. */
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN', // platform operator, cross-tenant
  TENANT_ADMIN = 'TENANT_ADMIN', // owns a tenant
  HR_MANAGER = 'HR_MANAGER',
  FINANCE_MANAGER = 'FINANCE_MANAGER',
  INVENTORY_MANAGER = 'INVENTORY_MANAGER',
  SALES_REP = 'SALES_REP',
  VIEWER = 'VIEWER', // read-only
}

export const ALL_ROLES: Role[] = Object.values(Role);

/** Narrow an arbitrary string[] (e.g. from a JWT) to known roles. */
export function toRoles(values: readonly string[] | undefined | null): Role[] {
  if (!values) return [];
  const known = new Set<string>(ALL_ROLES);
  return values.filter((v): v is Role => known.has(v));
}
