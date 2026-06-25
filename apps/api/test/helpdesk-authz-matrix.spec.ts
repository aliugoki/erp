import { describe, expect, it } from 'vitest';
import { Role } from '../src/modules/auth/rbac/role.enum';
import { rolesHavePermission } from '../src/modules/auth/rbac/permissions';

/**
 * Help Desk has two enforcement tiers, so it gets a bespoke matrix instead of the single-owner
 * generic one: `@Roles(...AGENT)` endpoints (SUPPORT_AGENT + admins) → `helpdesk:ticket:write`, and
 * `@Roles(...ADMIN)` endpoints (admins only) → `helpdesk:config:write`. The agent must NOT hold the
 * admin-only config permission.
 */
const ADMINS = [Role.TENANT_ADMIN, Role.SUPER_ADMIN];
const OTHER_CAPS = [Role.HR_MANAGER, Role.FINANCE_MANAGER, Role.INVENTORY_MANAGER, Role.SALES_REP, Role.VIEWER];

describe('helpdesk authorization matrix', () => {
  it('ticket work is granted to SUPPORT_AGENT + admins only', () => {
    expect(rolesHavePermission([Role.SUPPORT_AGENT], 'helpdesk:ticket:write')).toBe(true);
    for (const r of ADMINS) expect(rolesHavePermission([r], 'helpdesk:ticket:write')).toBe(true);
    for (const r of OTHER_CAPS) expect(rolesHavePermission([r], 'helpdesk:ticket:write')).toBe(false);
  });

  it('SLA/team config is admin-only — even SUPPORT_AGENT does NOT hold it', () => {
    expect(rolesHavePermission([Role.SUPPORT_AGENT], 'helpdesk:config:write')).toBe(false);
    for (const r of OTHER_CAPS) expect(rolesHavePermission([r], 'helpdesk:config:write')).toBe(false);
    for (const r of ADMINS) expect(rolesHavePermission([r], 'helpdesk:config:write')).toBe(true); // via wildcard
  });

  it('SUPPORT_AGENT can view tickets', () => {
    expect(rolesHavePermission([Role.SUPPORT_AGENT], 'helpdesk:ticket:read')).toBe(true);
  });
});
