/** Coarse roles assigned to users (ADR-006). Fine-grained access is expressed as permissions. */
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN', // platform operator, cross-tenant
  TENANT_ADMIN = 'TENANT_ADMIN', // owns a tenant
  HR_MANAGER = 'HR_MANAGER',
  FINANCE_MANAGER = 'FINANCE_MANAGER',
  INVENTORY_MANAGER = 'INVENTORY_MANAGER',
  SALES_REP = 'SALES_REP',
  SUPPORT_AGENT = 'SUPPORT_AGENT', // handles help-desk tickets
  // A delivery rider. Deliberately the narrowest role in the system: it carries exactly one
  // permission, and every route it reaches is scoped to that rider's OWN runs. A rider signs in on a
  // phone that lives in a jacket pocket and gets left on counters, so the blast radius of that device
  // in the wrong hands is one rider's job list — not the branch's order book, and not the door codes,
  // which the rider must still be told by the customer at the step.
  DRIVER = 'DRIVER',
  VIEWER = 'VIEWER', // read-only
}

export const ALL_ROLES: Role[] = Object.values(Role);

/** Narrow an arbitrary string[] (e.g. from a JWT) to known roles. */
export function toRoles(values: readonly string[] | undefined | null): Role[] {
  if (!values) return [];
  const known = new Set<string>(ALL_ROLES);
  return values.filter((v): v is Role => known.has(v));
}
