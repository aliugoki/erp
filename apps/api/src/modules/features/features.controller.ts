import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { Role } from '../auth/rbac/role.enum';
import { SkipAudit } from '../audit/skip-audit.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ToggleFeatureDto } from './dto/toggle-feature.dto';
import { FeatureService } from './feature.service';
import { RequiresFeature } from './requires-feature.decorator';

/** Per-tenant feature management + reflection for the web nav (ADR-009). */
@Controller('tenant/features')
export class FeaturesController {
  constructor(private readonly features: FeatureService) {}

  /** Catalog with this tenant's enabled flags — the web app renders nav/routes from this. A
   * SUPER_ADMIN (platform operator) sees everything enabled, independent of any tenant. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (user?.roles.includes(Role.SUPER_ADMIN)) return this.features.catalogAllEnabled();
    return this.features.catalogForTenant(TenantContext.require());
  }

  /** Enable/disable a feature for the current tenant (TENANT_ADMIN). Records its own audit. */
  @Patch(':key')
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  @SkipAudit()
  @HttpCode(HttpStatus.OK)
  async toggle(@Param('key') key: string, @Body() dto: ToggleFeatureDto) {
    await this.features.setEnabled(TenantContext.require(), key, dto.enabled);
    return { key, enabled: dto.enabled };
  }

  /** Probe endpoint gated by a feature — demonstrates (and lets the gate verify) FeatureGuard. */
  @Get('probe/reporting')
  @RequiresFeature('reporting')
  probe(): { ok: true } {
    return { ok: true };
  }
}
