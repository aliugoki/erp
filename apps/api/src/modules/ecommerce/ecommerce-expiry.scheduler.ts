import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@metaxperts/config';
import { EcommerceService } from './ecommerce.service';

const SWEEP_INTERVAL_MS = 300_000; // every 5 minutes

/**
 * Releases stock held by unpaid card orders whose payment session lapsed: across all tenants on a fixed
 * interval, cancels each expired-but-unpaid order and restocks it. Skips a tick if the prior run is
 * still in flight. Gated by `WORKER_REACTIONS_ENABLED` (off in tests, which trigger release on demand).
 */
@Injectable()
export class EcommerceExpiryScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EcommerceExpiryScheduler.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly ec: EcommerceService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Ecommerce order-expiry sweep disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    this.logger.log(`Ecommerce order-expiry sweep every ${SWEEP_INTERVAL_MS}ms`);
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const n = await this.ec.releaseExpiredAllTenants();
      if (n > 0) this.logger.log(`released ${n} expired unpaid order(s)`);
    } catch (err) {
      this.logger.error(`expiry sweep failed: ${(err as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
