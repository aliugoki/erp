import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../modules/auth/decorators/public.decorator';
import { RedisHealthIndicator } from './redis.health';
import { ReadinessHealthIndicator } from './readiness.service';

/**
 * Health endpoints (public allowlist; never rate-limited — probes must always get through).
 * - `GET /health`        liveness — process is up; no dependency checks.
 * - `GET /health/ready`  readiness — checks Postgres (via PgBouncer) + Redis, AND reports 503 while
 *                        the instance is draining for shutdown (Phase 7.4), so the LB pulls it from
 *                        rotation before it stops accepting. 200 only when all checks pass.
 */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly readiness: ReadinessHealthIndicator,
  ) {}

  @Get()
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  readiness_() {
    return this.health.check([
      () => this.readiness.check('draining'),
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
