import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedUser } from '../rbac/authenticated-user';
import { WILDCARD } from '../rbac/permissions';
import { Role } from '../rbac/role.enum';

/**
 * Roles whose holders may reach only the routes their own permissions name.
 *
 * These are field principals — a login on a device that leaves the building — rather than staff at a
 * console. Membership here is a deliberate, security-relevant decision: adding a role means its
 * holders lose the ordinary "authenticated staff may read" access that the rest of the API assumes.
 */
const CONFINED_ROLES = new Set<string>([Role.DRIVER]);

/** The permissions those roles legitimately use; anything else is out of bounds for them. */
const CONFINED_ROLE_PERMISSIONS = new Set<string>(['restaurant:delivery:run']);

/** True when every role the principal holds is a confined one (so no broader role widens them). */
function isConfined(user: AuthenticatedUser): boolean {
  const roles = user.roles ?? [];
  return roles.length > 0 && roles.every((r) => CONFINED_ROLES.has(r));
}

/**
 * Authorizes by fine-grained permission (Path 2, Phase C — now authoritative). A `@Permissions(...)`
 * route is reachable only if the principal's EFFECTIVE permissions (resolved at token issue from
 * built-in roles + custom-role permissions, carried in the `perms` claim) include every required
 * permission, or the wildcard. `RolesGuard` defers to this guard on permission-tagged routes.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;

    // A field-only principal is confined to the routes its role exists for.
    //
    // Most reads in this API require authentication and the module's feature entitlement, but no
    // specific permission — reasonable when every login belonged to back-office or floor staff. A
    // delivery rider is the first principal that does not: the login lives on a phone in a jacket
    // pocket, on the street, all shift. Without this, a rider could read every order in the branch
    // and the tenant's HR directory simply by being authenticated, which is exactly the exposure the
    // narrow DRIVER role is supposed to prevent.
    //
    // Scoped to principals holding ONLY confined roles. Someone who is a rider *and* a supervisor is
    // a supervisor, and the union of their permissions applies as normal.
    if (user && isConfined(user)) {
      const permitted = required?.some((p) => CONFINED_ROLE_PERMISSIONS.has(p)) ?? false;
      if (!permitted) throw new ForbiddenException('This login may only use the rider app');
    }

    if (!required || required.length === 0) return true;

    const held = new Set(user?.perms ?? []);
    if (!user || (!held.has(WILDCARD) && !required.every((p) => held.has(p)))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
