import { describe, expect, it } from 'vitest';
import { Role } from '../src/modules/auth/rbac/role.enum';
import {
  ROLE_PERMISSIONS,
  WILDCARD,
  permissionsForRoles,
  rolesHavePermission,
} from '../src/modules/auth/rbac/permissions';
import { ALL_PERMISSIONS, PERMISSION_SET } from '../src/modules/auth/rbac/permission-catalog';

/** Phase A guarantees: the permission catalog and the role→permission map are mutually consistent,
 * effective-permission resolution is correct, and the shadow divergence check behaves as designed. */
describe('rbac permissions (Path 2, Phase A)', () => {
  it('every non-wildcard permission a role grants is in the catalog', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const p of perms) {
        if (p === WILDCARD) continue;
        expect(PERMISSION_SET.has(p), `${role} grants uncatalogued "${p}"`).toBe(true);
      }
    }
  });

  it('every catalog permission is granted by at least one role', () => {
    const granted = new Set<string>();
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) granted.add(p);
    for (const p of ALL_PERMISSIONS) {
      expect(granted.has(p) || granted.has(WILDCARD), `no role grants "${p}"`).toBe(true);
    }
  });

  it('admins resolve to the wildcard; the wildcard satisfies any permission', () => {
    expect(permissionsForRoles([Role.TENANT_ADMIN]).has(WILDCARD)).toBe(true);
    expect(rolesHavePermission([Role.SUPER_ADMIN], 'finance:invoice:write')).toBe(true);
    expect(rolesHavePermission([Role.TENANT_ADMIN], 'anything:at:all')).toBe(true);
  });

  it('a capability role grants exactly its module permissions, not others', () => {
    expect(rolesHavePermission([Role.INVENTORY_MANAGER], 'inventory:product:write')).toBe(true);
    expect(rolesHavePermission([Role.INVENTORY_MANAGER], 'finance:invoice:write')).toBe(false);
    expect(rolesHavePermission([Role.FINANCE_MANAGER], 'finance:voucher:post')).toBe(true);
    expect(rolesHavePermission([Role.FINANCE_MANAGER], 'hr:employee:write')).toBe(false);
  });

  it('VIEWER is read-only', () => {
    const perms = permissionsForRoles([Role.VIEWER]);
    expect([...perms].every((p) => p.endsWith(':read'))).toBe(true);
    expect(rolesHavePermission([Role.VIEWER], 'finance:invoice:write')).toBe(false);
  });

  it('shadow divergence: a role-allowed principal lacking the mapped permission is detected', () => {
    // Mirrors PermissionsGuard's shadow filter: which required perms are NOT satisfied by the roles.
    const required = ['finance:invoice:write'];
    const sales = required.filter((p) => !rolesHavePermission([Role.SALES_REP], p));
    expect(sales).toEqual(['finance:invoice:write']); // SALES_REP would diverge here
    const finance = required.filter((p) => !rolesHavePermission([Role.FINANCE_MANAGER], p));
    expect(finance).toEqual([]); // FINANCE_MANAGER is consistent — no divergence
  });
});
