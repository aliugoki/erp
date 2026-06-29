import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ReportBuilderService } from './report-builder.service';
import { ReportScheduleScheduler } from './report-schedule.scheduler';
import { ReportScheduleService } from './report-schedule.service';
import { ReportSchedulesController } from './report-schedules.controller';
import { ReportsController } from './reports.controller';
import { ReportingService } from './reporting.service';
import { ReportingRefreshScheduler } from './reporting.scheduler';

/**
 * Reporting (Chunk 5.2): cross-module reports served from per-tenant read models, refreshed on a
 * schedule (or on demand via POST /reports/refresh), plus the preset + custom report builder, the BI
 * analytics dashboard, and scheduled report emails.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ReportsController, AnalyticsController, ReportSchedulesController],
  providers: [
    ReportingService,
    ReportingRefreshScheduler,
    ReportBuilderService,
    AnalyticsService,
    ReportScheduleService,
    ReportScheduleScheduler,
  ],
  exports: [ReportingService],
})
export class ReportingModule {}
