import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ServiceOnly } from './service-only.decorator';

/**
 * Internal endpoints — not user-facing. `@Public()` skips the user JWT guard; `@ServiceOnly()` then
 * requires a valid service token. The ML/worker bridges (Phase 6) will call routes like these.
 */
@Controller('internal')
export class InternalController {
  @Get('ping')
  @Public()
  @ServiceOnly()
  ping(): { ok: true; service: 'api' } {
    return { ok: true, service: 'api' };
  }
}
