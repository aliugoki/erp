/**
 * Overload/shutdown unit test (Chunk 7.4). Verifies the readiness-draining logic: a fresh instance is
 * ready; once draining (manually or via the shutdown hook) the readiness indicator reports unhealthy
 * (→ /health/ready 503) so a load balancer pulls it before it stops accepting. The live rate-limiting
 * (429 + Retry-After) and graceful SIGTERM behaviours are covered by overload-e2e.sh.
 */
import { describe, expect, it } from 'vitest';
import { ReadinessHealthIndicator, ReadinessService } from '../src/health/readiness.service';

const config = { get: () => 0 } as never; // SHUTDOWN_DRAIN_MS = 0 (no delay in tests)

describe('ReadinessService', () => {
  it('starts ready and flips to draining on shutdown', async () => {
    const svc = new ReadinessService(config);
    expect(svc.isDraining).toBe(false);
    await svc.beforeApplicationShutdown('SIGTERM');
    expect(svc.isDraining).toBe(true);
  });

  it('markDraining flips the flag without a real shutdown', () => {
    const svc = new ReadinessService(config);
    svc.markDraining();
    expect(svc.isDraining).toBe(true);
  });
});

describe('ReadinessHealthIndicator', () => {
  it('is healthy until draining, then throws (→ 503)', () => {
    const svc = new ReadinessService(config);
    const indicator = new ReadinessHealthIndicator(svc);
    expect(indicator.check('draining').draining.status).toBe('up');
    svc.markDraining();
    expect(() => indicator.check('draining')).toThrow();
  });
});
