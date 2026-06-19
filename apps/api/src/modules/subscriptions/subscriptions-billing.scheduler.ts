import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@metaxperts/config';
import { SubscriptionsService } from './subscriptions.service';

const BILLING_INTERVAL_MS = 300_000; // every 5 minutes

/**
 * The recurring-billing engine's heartbeat. On a fixed interval it runs the billing cycle across all
 * tenants: every subscription whose next billing date has passed gets a new invoice (auto-collected or
 * left open), and every overdue open invoice is dunned — escalating to cancellation after the maximum
 * attempts. Skips a tick if the prior run is still in flight. Gated by `WORKER_REACTIONS_ENABLED`.
 * Mirrors the helpdesk SLA scheduler.
 */
@Injectable()
export class SubscriptionsBillingScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionsBillingScheduler.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly subs: SubscriptionsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('WORKER_REACTIONS_ENABLED', { infer: true })) {
      this.logger.log('Subscription billing engine disabled (WORKER_REACTIONS_ENABLED is not set)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), BILLING_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    this.logger.log(`Subscription billing cycle every ${BILLING_INTERVAL_MS}ms`);
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const r = await this.subs.runBillingAllTenants();
      if (r.billed || r.dunned || r.canceled) {
        this.logger.log(`billing cycle: ${r.billed} invoiced, ${r.dunned} dunned, ${r.canceled} cancelled`);
      }
    } catch (err) {
      this.logger.error(`billing cycle failed: ${(err as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
