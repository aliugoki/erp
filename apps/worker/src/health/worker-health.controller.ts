import { Controller, Get } from '@nestjs/common';
import type { SuccessEnvelope } from '@metaxperts/shared';

/**
 * Worker health surface. `/worker/health` is liveness; `/worker/health/ready` is readiness used to
 * gate the worker into rotation. The event reaction handlers (Chunk 4.4) currently run in the API
 * process (single runtime per ADR-001); this app is reserved for scaling reactions out under load.
 */
@Controller('worker/health')
export class WorkerHealthController {
  @Get()
  health(): SuccessEnvelope<{ status: 'ok' }> {
    return { data: { status: 'ok' } };
  }

  @Get('ready')
  readiness(): SuccessEnvelope<{ status: 'ok' }> {
    return { data: { status: 'ok' } };
  }
}
