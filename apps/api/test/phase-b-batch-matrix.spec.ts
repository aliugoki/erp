import { describe, expect, it } from 'vitest';
import { Role } from '../src/modules/auth/rbac/role.enum';
import { rolesHavePermission } from '../src/modules/auth/rbac/permissions';

/**
 * Authorization matrix for the final Phase B batch (POS, Projects, Assets, Production, Pharmacy,
 * Ecommerce, Subscriptions, Reporting). These modules mix single-owner, multi-owner and admin-only
 * permissions, so the matrix is expectation-driven: for each permission, the exact set of capability
 * roles that should hold it. Admins always hold everything (wildcard). An empty set = admin-only.
 */
const EXPECT: Record<string, Role[]> = {
  'pos:sale:write': [Role.SALES_REP],
  'pos:report:read': [Role.SALES_REP, Role.FINANCE_MANAGER],
  'pos:glconfig:write': [Role.FINANCE_MANAGER],
  'pos:config:write': [],
  'project:write': [Role.HR_MANAGER],
  'asset:write': [Role.FINANCE_MANAGER],
  'production:write': [Role.INVENTORY_MANAGER],
  'production:glconfig:read': [Role.FINANCE_MANAGER, Role.INVENTORY_MANAGER],
  'production:glconfig:write': [Role.FINANCE_MANAGER],
  'pharmacy:operate': [Role.INVENTORY_MANAGER, Role.SALES_REP],
  'pharmacy:config': [],
  'ecommerce:manage': [],
  'ecommerce:finance:write': [Role.FINANCE_MANAGER],
  'subscription:write': [Role.FINANCE_MANAGER],
  'report:write': [],
};

const CAPS = [
  Role.HR_MANAGER,
  Role.FINANCE_MANAGER,
  Role.INVENTORY_MANAGER,
  Role.SALES_REP,
  Role.SUPPORT_AGENT,
  Role.VIEWER,
];

describe('phase B batch authorization matrix', () => {
  for (const [perm, owners] of Object.entries(EXPECT)) {
    it(`${perm}: held by exactly ${owners.length ? owners.join('+') : 'admins-only'} (+ admins)`, () => {
      for (const r of CAPS) {
        expect(rolesHavePermission([r], perm), `${r} vs ${perm}`).toBe(owners.includes(r));
      }
      expect(rolesHavePermission([Role.TENANT_ADMIN], perm)).toBe(true);
      expect(rolesHavePermission([Role.SUPER_ADMIN], perm)).toBe(true);
    });
  }
});
