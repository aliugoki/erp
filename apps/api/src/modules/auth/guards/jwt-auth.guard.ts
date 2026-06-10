import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AppConfig } from '@metaxperts/config';
import { RequestContext } from '../../../common/request-context/request-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../rbac/authenticated-user';
import { toRoles } from '../rbac/role.enum';

interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  roles?: string[];
}

/**
 * Global authentication guard. Skips routes on the public allowlist (`@Public()` → `/health*`,
 * `/auth/*`); otherwise requires a valid Bearer access token. On success it attaches the principal to
 * `request.user` and seeds RequestContext with userId/tenantId (the per-request RLS GUC wiring lands
 * in Chunk 2.3).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(header.slice(7), {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Every principal is bound to exactly one tenant; reject tokens that carry none (ADR-002).
    if (!payload.tenantId) {
      throw new UnauthorizedException('Token is not bound to a tenant');
    }

    const user: AuthenticatedUser = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      roles: toRoles(payload.roles),
    };
    req.user = user;
    // Seed RequestContext so services' TenantTransactionService runs queries with this tenant's
    // app.tenant_id GUC (the per-request RLS enforcement for business data).
    RequestContext.set({ userId: user.userId, tenantId: user.tenantId });
    return true;
  }
}
