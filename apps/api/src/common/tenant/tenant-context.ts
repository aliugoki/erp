import { ForbiddenException } from '@nestjs/common';
import { RequestContext } from '../request-context/request-context';

/**
 * Reads the current tenant from the request-scoped AsyncLocalStorage (populated from the JWT by the
 * TenantInterceptor in Phase 2.3). This is the single place app code asks "which tenant am I?".
 */
export const TenantContext = {
  /** The current tenant id, or undefined outside a tenant-bound request. */
  current(): string | undefined {
    return RequestContext.tenantId();
  },

  /** The current tenant id, or throw — use where a tenant is mandatory. */
  require(): string {
    const tenantId = RequestContext.tenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in request context');
    }
    return tenantId;
  },
};
