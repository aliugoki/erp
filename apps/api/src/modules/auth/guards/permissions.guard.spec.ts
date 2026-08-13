import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { Role } from '../rbac/role.enum';
import { PermissionsGuard } from './permissions.guard';

/** A context whose route declares `required` and whose principal holds `roles`/`perms`. */
function ctx(required: string[] | undefined, user: { roles: string[]; perms: string[] } | undefined) {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never;
  return { guard: new PermissionsGuard(reflector), context };
}

const rider = { roles: [Role.DRIVER], perms: ['restaurant:delivery:run'] };
const waiter = { roles: [Role.SALES_REP], perms: ['restaurant:order:write'] };

/**
 * Cover for a hole found by signing in as a real rider against the live server.
 *
 * Most reads in this API require authentication and a feature entitlement but no specific permission
 * — fine while every login belonged to office or floor staff. The DRIVER role broke that assumption:
 * it put a login on a phone that lives on the street all shift, and being merely authenticated was
 * enough to read every order in the branch and the tenant's HR directory.
 */
describe('PermissionsGuard — confined field roles', () => {
  it('lets a rider reach a route that names their own permission', () => {
    const { guard, context } = ctx(['restaurant:delivery:run'], rider);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuses a rider on a route that requires no permission at all', () => {
    // The actual hole: GET /restaurant/orders and /hr/employees declare nothing, so an authenticated
    // principal walked straight in.
    const { guard, context } = ctx(undefined, rider);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses a rider on another module’s permissioned route', () => {
    const { guard, context } = ctx(['restaurant:delivery:dispatch'], rider);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('does not confine ordinary staff on unpermissioned routes', () => {
    // The rest of the API must behave exactly as before — this is a rider-shaped restriction, not a
    // new global default.
    const { guard, context } = ctx(undefined, waiter);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('does not confine someone who is a rider AND something broader', () => {
    // A supervisor who also rides is a supervisor; the union of their permissions applies as normal.
    const hybrid = { roles: [Role.DRIVER, Role.SALES_REP], perms: ['restaurant:delivery:run', 'restaurant:order:write'] };
    const { guard, context } = ctx(undefined, hybrid);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('still enforces ordinary permission checks', () => {
    const { guard, context } = ctx(['finance:invoice:write'], waiter);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
