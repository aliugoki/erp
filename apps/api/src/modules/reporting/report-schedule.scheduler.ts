import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@metaxperts/config';
import { ReportScheduleService } from './report-schedule.service';

/**
 * Periodically renders + emails due report schedules across all tenants when enabled
 * (REPORT_SCHEDULES_ENABLED). Skips a tick if the previous run is still in flight. Disabled by default
 * (tests drive delivery deterministically via POST /reports/schedules/:id/run).
 */
@Injectable()
export class ReportScheduleScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReportScheduleScheduler.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly schedules: ReportScheduleService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('REPORT_SCHEDULES_ENABLED', { infer: true })) {
      this.logger.log('Report schedules disabled (REPORT_SCHEDULES_ENABLED is not set)');
      return;
    }
    const interval = this.config.get('REPORT_SCHEDULES_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => void this.tick(), interval);
    if (this.timer.unref) this.timer.unref();
    this.logger.log(`Report schedule tick every ${interval}ms`);
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const n = await this.schedules.runDueAllTenants(new Date());
      if (n) this.logger.debug(`report schedules: delivered ${n} due`);
    } catch (err) {
      this.logger.error(`report schedule tick failed: ${(err as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
