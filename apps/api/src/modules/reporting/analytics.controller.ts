import { Controller, Get } from '@nestjs/common';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { AnalyticsService } from './analytics.service';

/** BI analytics dashboard — a single cross-module payload (KPIs + trend + breakdowns), served from the
 * tenant-scoped reporting read models. Gated by the `reporting` feature; auth + tenant guards apply globally. */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @RequiresFeature('reporting')
  dashboard() {
    return this.analytics.dashboard();
  }
}
