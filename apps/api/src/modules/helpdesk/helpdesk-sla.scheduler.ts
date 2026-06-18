import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@metaxperts/config';
import { HelpdeskService } from './helpdesk.service';

const SWEEP_INTERVAL_MS = 120_000; // every 2 minutes

/**
 * Flags SLA breaches across all tenants on a fixed interval: any open ticket whose first-response or
 * resolution target has passed (clock not paused, target not yet met) is marked breached and a
 * `helpdesk.sla_breached` event is emitted (once per breach type) for notifications. Skips a tick if the
 * prior run is still in flight. Gated by `WORKER_REACTIONS_ENABLED`. Mirrors the ecommerce expiry sweep.
 */
@Injectable()
export class HelpdeskSlaScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HelpdeskSlaScheduler.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly hd: HelpdeskService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Helpdesk SLA breach sweep disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    this.logger.log(`Helpdesk SLA breach sweep every ${SWEEP_INTERVAL_MS}ms`);
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const n = await this.hd.sweepBreachesAllTenants();
      if (n > 0) this.logger.warn(`flagged ${n} SLA breach(es)`);
    } catch (err) {
      this.logger.error(`SLA sweep failed: ${(err as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
