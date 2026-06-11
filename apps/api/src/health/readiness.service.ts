import { type BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import type { AppConfig } from '@metaxperts/config';

/**
 * Readiness gating for zero-downtime deploys (Phase 7.4). On a shutdown signal the service flips to
 * "draining" BEFORE the HTTP server stops accepting, and holds for `SHUTDOWN_DRAIN_MS` — during that
 * window `/health/ready` returns 503, so a load balancer pulls this instance out of rotation while
 * it's still serving in-flight requests. Result: a rolling restart drops zero in-flight work.
 */
@Injectable()
export class ReadinessService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ReadinessService.name);
  private readonly drainMs: number;
  private draining = false;

  constructor(config: ConfigService<AppConfig, true>) {
    this.drainMs = config.get('SHUTDOWN_DRAIN_MS', { infer: true });
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /** Test/manual hook to flip the flag without a real shutdown. */
  markDraining(): void {
    this.draining = true;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.logger.log(`draining (signal=${signal ?? 'n/a'}); /health/ready → 503 for ${this.drainMs}ms`);
    if (this.drainMs > 0) await new Promise((resolve) => setTimeout(resolve, this.drainMs));
  }
}

/** Terminus indicator: unhealthy (→ 503) while the instance is draining. */
@Injectable()
export class ReadinessHealthIndicator extends HealthIndicator {
  constructor(private readonly readiness: ReadinessService) {
    super();
  }

  check(key: string): HealthIndicatorResult {
    const ok = !this.readiness.isDraining;
    const result = this.getStatus(key, ok, { draining: this.readiness.isDraining });
    if (ok) return result;
    throw new HealthCheckError('instance is draining', result);
  }
}
