import { describe, expect, it } from 'vitest';
import { Role } from '../src/modules/auth/rbac/role.enum';
import { rolesHavePermission } from '../src/modules/auth/rbac/permissions';
import { PERMISSION_CATALOG } from '../src/modules/auth/rbac/permission-catalog';

/**
 * Per-module authorization matrix (Path 2, Phase B). For each tagged module, asserts every write
 * permission maps to exactly the module's owner role + admins (matching the existing `@Roles(...WRITE)`
 * = [<owner>, TENANT_ADMIN, SUPER_ADMIN]), and reads stay visible to VIEWER. Green here means the
 * Phase C flip from role- to permission-enforcement is a no-op for that module's access.
 */
const MODULES: Array<{ domain: string; owner: Role }> = [
  { domain: 'hr', owner: Role.HR_MANAGER },
  { domain: 'inventory', owner: Role.INVENTORY_MANAGER },
  { domain: 'crm', owner: Role.SALES_REP },
  { domain: 'sales', owner: Role.SALES_REP },
];
const ADMINS = [Role.TENANT_ADMIN, Role.SUPER_ADMIN];
const CAPS = [
  Role.HR_MANAGER,
  Role.FINANCE_MANAGER,
  Role.INVENTORY_MANAGER,
  Role.SALES_REP,
  Role.SUPPORT_AGENT,
  Role.VIEWER,
];

describe('module authorization matrix', () => {
  for (const { domain, owner } of MODULES) {
    const perms = (PERMISSION_CATALOG.find((g) => g.domain === domain)?.permissions ?? []).map((p) => p.key);
    const writes = perms.filter((p) => !p.endsWith(':read'));
    const reads = perms.filter((p) => p.endsWith(':read'));

    it(`${domain}: every write permission is held by ${owner} + admins only`, () => {
      expect(writes.length).toBeGreaterThan(0);
      for (const p of writes) {
        expect(rolesHavePermission([owner], p), `${owner} should hold ${p}`).toBe(true);
        for (const r of ADMINS) expect(rolesHavePermission([r], p)).toBe(true);
        for (const r of CAPS.filter((x) => x !== owner)) {
          expect(rolesHavePermission([r], p), `${r} must NOT hold ${p}`).toBe(false);
        }
      }
    });

    it(`${domain}: reads stay visible to VIEWER + ${owner}`, () => {
      for (const p of reads) {
        expect(rolesHavePermission([Role.VIEWER], p)).toBe(true);
        expect(rolesHavePermission([owner], p)).toBe(true);
      }
    });
  }
});
