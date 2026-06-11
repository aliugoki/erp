import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@metaxperts/config';
import { ReportingService } from './reporting.service';

/**
 * Recomputes the reporting read models for all tenants on a fixed interval when enabled
 * (REPORTING_REFRESH_ENABLED). Skips a tick if the previous run is still in flight. Disabled by
 * default (tests refresh on demand via POST /reports/refresh for determinism).
 */
@Injectable()
export class ReportingRefreshScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReportingRefreshScheduler.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly reporting: ReportingService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('REPORTING_REFRESH_ENABLED', { infer: true })) {
      this.logger.log('Reporting refresh disabled (REPORTING_REFRESH_ENABLED is not set)');
      return;
    }
    const interval = this.config.get('REPORTING_REFRESH_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => void this.tick(), interval);
    if (this.timer.unref) this.timer.unref();
    this.logger.log(`Reporting refresh every ${interval}ms`);
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const n = await this.reporting.refreshAllTenants();
      this.logger.debug(`reporting refresh: ${n} tenants`);
    } catch (err) {
      this.logger.error(`reporting refresh failed: ${(err as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
