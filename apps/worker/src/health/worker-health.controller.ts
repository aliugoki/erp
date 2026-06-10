import { Controller, Get } from '@nestjs/common';
import type { SuccessEnvelope } from '@metaxperts/shared';

/**
 * Worker liveness endpoint. The worker runs a thin HTTP surface for health/readiness alongside its
 * (BullMQ) consumers, which are wired in Phase 4. Readiness (broker + Redis) arrives later.
 */
@Controller('worker/health')
export class WorkerHealthController {
  @Get()
  health(): SuccessEnvelope<{ status: 'ok' }> {
    return { data: { status: 'ok' } };
  }
}
