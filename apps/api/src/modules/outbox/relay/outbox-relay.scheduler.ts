import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@metaxperts/config';
import { OutboxRelay } from './outbox-relay.service';

/**
 * Runs the outbox relay on a fixed interval when enabled (OUTBOX_RELAY_ENABLED). Skips a tick if the
 * previous one is still in flight, so polls never overlap. Disabled by default (e.g. in tests, where
 * business e2e suites assert events stay pending) and driven directly via OutboxRelay there.
 */
@Injectable()
export class OutboxRelayScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayScheduler.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly relay: OutboxRelay,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('OUTBOX_RELAY_ENABLED', { infer: true })) {
      this.logger.log('Outbox relay disabled (OUTBOX_RELAY_ENABLED is not set)');
      return;
    }
    const interval = this.config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => void this.tick(), interval);
    if (this.timer.unref) this.timer.unref();
    this.logger.log(`Outbox relay polling every ${interval}ms`);
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const batch = this.config.get('OUTBOX_BATCH_SIZE', { infer: true });
      const r = await this.relay.processBatch(batch);
      if (r.published || r.failed) {
        this.logger.debug(`relay: published=${r.published} failed=${r.failed}`);
      }
    } catch (err) {
      this.logger.error(`relay tick failed: ${(err as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
