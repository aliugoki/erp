import { Module } from '@nestjs/common';
import { ReportBuilderService } from './report-builder.service';
import { ReportsController } from './reports.controller';
import { ReportingService } from './reporting.service';
import { ReportingRefreshScheduler } from './reporting.scheduler';

/**
 * Reporting (Chunk 5.2): cross-module reports served from per-tenant read models, refreshed on a
 * schedule (or on demand via POST /reports/refresh), plus the preset + custom report builder.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportingService, ReportingRefreshScheduler, ReportBuilderService],
  exports: [ReportingService],
})
export class ReportingModule {}
