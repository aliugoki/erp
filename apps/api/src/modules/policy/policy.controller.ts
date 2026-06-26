import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { SetPolicyDto } from './dto/set-policy.dto';
import { PolicyService } from './policy.service';

/**
 * Company-admin business-rule policies. A TENANT_ADMIN views the catalog with this tenant's effective
 * values and sets/resets overrides. Tenant-scoped via RLS — a company only ever sees/sets its own.
 */
@Controller('tenant/policies')
@Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
export class PolicyController {
  constructor(private readonly policies: PolicyService) {}

  @Get()
  list() {
    return this.policies.listForTenant();
  }

  @Put(':key')
  set(@Param('key') key: string, @Body() dto: SetPolicyDto) {
    return this.policies.set(key, dto.value);
  }

  @Delete(':key')
  reset(@Param('key') key: string) {
    return this.policies.reset(key);
  }
}
