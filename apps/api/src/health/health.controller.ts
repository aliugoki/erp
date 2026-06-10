import { Controller, Get } from '@nestjs/common';
import type { SuccessEnvelope } from '@metaxperts/shared';

/**
 * Liveness endpoint. Returns the success envelope shape directly for now; the global response
 * interceptor that auto-wraps every response in `{ data, meta }` arrives with the kernel (Chunk 1.3),
 * along with `/health/ready` (DB + Redis readiness).
 */
@Controller('health')
export class HealthController {
  @Get()
  health(): SuccessEnvelope<{ status: 'ok' }> {
    return { data: { status: 'ok' } };
  }
}
