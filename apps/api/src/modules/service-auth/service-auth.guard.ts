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
import { SERVICE_AUDIENCE, SERVICE_ISSUER } from './service-token.service';
import { SERVICE_ONLY_KEY } from './service-only.decorator';

/**
 * Enforces service-to-service auth on `@ServiceOnly()` routes: a valid `x-service-token` (signed
 * with SERVICE_AUTH_SECRET, audience `internal`) is required. Non-internal routes pass through.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isServiceOnly = this.reflector.getAllAndOverride<boolean>(SERVICE_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isServiceOnly) return true;

    const req = context.switchToHttp().getRequest();
    const header = req.headers?.['x-service-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) throw new UnauthorizedException('Missing service token');

    try {
      this.jwt.verify(token, {
        secret: this.config.get('SERVICE_AUTH_SECRET', { infer: true }),
        audience: SERVICE_AUDIENCE,
        issuer: SERVICE_ISSUER,
      });
      return true;
    } catch {
      throw new UnauthorizedException('Invalid service token');
    }
  }
}
