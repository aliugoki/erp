import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RequestContext } from '../request-context/request-context';

/**
 * Rate limiting keyed per-TENANT for authenticated requests and per-IP for anonymous ones (Phase
 * 7.4). The tenant comes from the request-scoped context (set by the auth guard); under overload the
 * limiter sheds load with 429 (`@nestjs/throttler` adds `Retry-After`/`X-RateLimit-*` automatically)
 * instead of letting one noisy tenant or client degrade everyone.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const tenantId = RequestContext.tenantId();
    if (tenantId) return Promise.resolve(`t:${tenantId}`);
    const ips = req.ips as string[] | undefined;
    const ip = (ips && ips.length ? ips[0] : (req.ip as string | undefined)) ?? 'unknown';
    return Promise.resolve(`ip:${ip}`);
  }
}
