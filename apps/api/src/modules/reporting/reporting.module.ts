import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportingService } from './reporting.service';
import { ReportingRefreshScheduler } from './reporting.scheduler';

/**
 * Reporting (Chunk 5.2): cross-module reports served from per-tenant read models, refreshed on a
 * schedule (or on demand via POST /reports/refresh).
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportingService, ReportingRefreshScheduler],
  exports: [ReportingService],
})
export class ReportingModule {}
