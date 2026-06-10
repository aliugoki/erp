import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

/**
 * Health endpoints (public allowlist).
 * - `GET /health`        liveness — process is up; no dependency checks.
 * - `GET /health/ready`  readiness — checks Postgres (via PgBouncer) + Redis; 200 only when both are
 *                        reachable, 503 (RFC 7807) otherwise. Used by orchestrators to gate traffic.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
