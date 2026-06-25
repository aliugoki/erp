import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../rbac/authenticated-user';
import type { Role } from '../rbac/role.enum';

/**
 * Authorizes by coarse role: the user must hold at least one of the route's required roles.
 *
 * Path 2 Phase C: when a route also declares `@Permissions(...)`, authorization is delegated to the
 * fine-grained PermissionsGuard and this guard defers (returns true). This lets custom permission-only
 * roles reach permission-tagged endpoints without holding a specific built-in role. Routes with only
 * `@Roles(...)` and no permission tag (platform/admin routes) stay role-enforced here.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const hasPermissionTag = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (hasPermissionTag && hasPermissionTag.length) return true; // PermissionsGuard is authoritative

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user || !user.roles.some((r) => required.includes(r))) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
