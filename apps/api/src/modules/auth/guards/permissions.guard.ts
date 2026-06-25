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
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    const held = new Set(user?.perms ?? []);
    if (!user || (!held.has(WILDCARD) && !required.every((p) => held.has(p)))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
