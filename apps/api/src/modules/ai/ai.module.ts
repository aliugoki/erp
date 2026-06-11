import { Module } from '@nestjs/common';
import { ServiceAuthModule } from '../service-auth/service-auth.module';
import { AiController } from './ai.controller';
import { MlService } from './ml.service';

/**
 * AI bridge (Chunk 6.5): the resilient API→ML client + the `/api/ai/*` surface. Imports
 * ServiceAuthModule for the signed service token attached to every ML call.
 */
@Module({
  imports: [ServiceAuthModule],
  controllers: [AiController],
  providers: [MlService],
  exports: [MlService],
})
export class AiModule {}
