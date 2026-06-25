import { describe, expect, it } from 'vitest';
import { Role } from '../src/modules/auth/rbac/role.enum';
import { rolesHavePermission } from '../src/modules/auth/rbac/permissions';
import { PERMISSION_CATALOG } from '../src/modules/auth/rbac/permission-catalog';

/**
 * Finance authorization matrix (Path 2, Phase B). Asserts the permission the Finance endpoints are
 * shadow-tagged with maps to the same principals the existing `@Roles(...WRITE)` allows
 * (WRITE = FINANCE_MANAGER + TENANT_ADMIN + SUPER_ADMIN). If this stays green, flipping Finance from
 * role-enforcement to permission-enforcement in Phase C is a no-op for access.
 */
const financePerms = (PERMISSION_CATALOG.find((g) => g.domain === 'finance')?.permissions ?? []).map((p) => p.key);
const writes = financePerms.filter((p) => !p.endsWith(':read'));
const reads = financePerms.filter((p) => p.endsWith(':read'));

const WRITE_ROLES = [Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN];
const NON_FINANCE = [Role.HR_MANAGER, Role.INVENTORY_MANAGER, Role.SALES_REP, Role.SUPPORT_AGENT];

describe('finance authorization matrix', () => {
  it('has a populated finance permission group', () => {
    expect(writes.length).toBeGreaterThanOrEqual(13);
  });

  it('every finance write permission is granted to FINANCE_MANAGER + admins, and to no one else', () => {
    for (const p of writes) {
      for (const r of WRITE_ROLES) expect(rolesHavePermission([r], p), `${r} should hold ${p}`).toBe(true);
      for (const r of NON_FINANCE) expect(rolesHavePermission([r], p), `${r} must NOT hold ${p}`).toBe(false);
      expect(rolesHavePermission([Role.VIEWER], p), `VIEWER must NOT hold ${p}`).toBe(false);
    }
  });

  it('finance reads remain visible to VIEWER, FINANCE_MANAGER and admins', () => {
    for (const p of reads) {
      expect(rolesHavePermission([Role.VIEWER], p)).toBe(true);
      expect(rolesHavePermission([Role.FINANCE_MANAGER], p)).toBe(true);
      expect(rolesHavePermission([Role.TENANT_ADMIN], p)).toBe(true);
    }
  });
});
