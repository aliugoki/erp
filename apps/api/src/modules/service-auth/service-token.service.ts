import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AppConfig } from '@metaxperts/config';

export const SERVICE_AUDIENCE = 'internal';
export const SERVICE_ISSUER = 'metaxperts-api';

/**
 * Mints short-lived signed service tokens for internal calls (API → ML / worker). The calling side
 * (e.g. the ML bridge in Phase 6) attaches `issue()` output as the `x-service-token` header.
 */
@Injectable()
export class ServiceTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  issue(callerService = 'api'): string {
    return this.jwt.sign(
      { svc: callerService },
      {
        secret: this.config.get('SERVICE_AUTH_SECRET', { infer: true }),
        audience: SERVICE_AUDIENCE,
        issuer: SERVICE_ISSUER,
        expiresIn: this.config.get('SERVICE_AUTH_TTL', { infer: true }),
      },
    );
  }
}
