import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';

/** Terminus health indicator that PINGs Redis; reports unhealthy (→ 503) when unreachable. */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      const ok = pong === 'PONG';
      const result = this.getStatus(key, ok);
      if (ok) return result;
      throw new HealthCheckError('Redis ping did not return PONG', result);
    } catch (err) {
      throw new HealthCheckError(
        'Redis unreachable',
        this.getStatus(key, false, { message: (err as Error).message }),
      );
    }
  }
}
