import { Controller, Get } from '@nestjs/common';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { AiInsightsService } from './ai-insights.service';

/** AI Insights — read-only, ML-powered analytics across modules. Gated by the `ai` feature. */
@Controller('ai/insights')
@RequiresFeature('ai')
export class AiInsightsController {
  constructor(private readonly ai: AiInsightsService) {}

  @Get('summary')
  summary() {
    return this.ai.summary();
  }

  @Get('sales-forecast')
  salesForecast() {
    return this.ai.salesForecast();
  }

  @Get('lead-scores')
  leadScores() {
    return this.ai.leadScores();
  }

  @Get('inventory-demand')
  inventoryDemand() {
    return this.ai.inventoryDemand();
  }

  @Get('attrition-risk')
  attritionRisk() {
    return this.ai.attritionRisk();
  }

  @Get('anomalies')
  anomalies() {
    return this.ai.anomalies();
  }
}
