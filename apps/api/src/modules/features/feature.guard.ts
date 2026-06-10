import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../../common/request-context/request-context';
import { FeatureService } from './feature.service';
import { REQUIRES_FEATURE_KEY } from './requires-feature.decorator';

/**
 * Enforces feature entitlements (ADR-009): a `@RequiresFeature(key)` route is reachable only if the
 * caller's tenant has that feature enabled. This is the authoritative check — the UI hiding a module
 * is convenience only. Runs after auth/tenant guards so the tenant is known.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(REQUIRES_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const tenantId = RequestContext.tenantId();
    if (!tenantId) throw new ForbiddenException('No tenant in context');
    if (!(await this.features.isEnabled(tenantId, required))) {
      throw new ForbiddenException(`Feature "${required}" is not enabled for this tenant`);
    }
    return true;
  }
}
