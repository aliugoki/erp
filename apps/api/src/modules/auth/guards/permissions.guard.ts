import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SHADOW_PERMISSIONS_KEY } from '../decorators/shadow-permissions.decorator';
import type { AuthenticatedUser } from '../rbac/authenticated-user';
import { rolesHavePermission } from '../rbac/permissions';

/**
 * Authorizes by fine-grained permission: the user's roles must grant ALL required `@Permissions(...)`.
 *
 * Path 2 dual-run: an endpoint may also carry `@ShadowPermissions(...)`. Those are **log-only** — the
 * guard computes the permission decision and, when a role-allowed principal would be DENIED by the
 * permission model, logs a structured divergence (so we can map gaps before flipping enforcement in
 * Phase C). It never blocks on shadow permissions.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger('RbacShadow');

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;

    // Dual-run telemetry (log-only; this guard runs after RolesGuard, so the request is role-allowed).
    const shadow = this.reflector.getAllAndOverride<string[]>(SHADOW_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (shadow && shadow.length) {
      const missing = shadow.filter((p) => !user || !rolesHavePermission(user.roles, p));
      if (missing.length) {
        const req = context.switchToHttp().getRequest();
        this.logger.warn(
          `divergence: ${req.method} ${req.url} role-allowed but permission-model would deny ` +
            `[${missing.join(', ')}] (roles=${(user?.roles ?? []).join(',') || 'none'})`,
        );
      }
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    if (!user || !required.every((p) => rolesHavePermission(user.roles, p))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
