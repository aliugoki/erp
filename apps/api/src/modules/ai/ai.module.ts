import { Module } from '@nestjs/common';
import { ServiceAuthModule } from '../service-auth/service-auth.module';
import { AiInsightsController } from './ai-insights.controller';
import { AiInsightsService } from './ai-insights.service';
import { AiController } from './ai.controller';
import { MlService } from './ml.service';

/**
 * AI bridge (Chunk 6.5): the resilient API→ML client + the `/api/ai/*` surface. Imports
 * ServiceAuthModule for the signed service token attached to every ML call. Also hosts AI Insights —
 * tenant-local, ML-powered analytics computed from each module's data.
 */
@Module({
  imports: [ServiceAuthModule],
  controllers: [AiController, AiInsightsController],
  providers: [MlService, AiInsightsService],
  exports: [MlService],
})
export class AiModule {}
