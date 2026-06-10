import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { SkipAudit } from '../audit/skip-audit.decorator';
import { SetActiveDto } from './dto/set-active.dto';
import { UsersService } from './users.service';

/** Read access to users, tenant-scoped by RLS (a cross-tenant id returns 404). */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findByIdInTenant(id);
  }

  /** Activate/deactivate a user (TENANT_ADMIN). Records its own before/after audit, so it opts out
   * of the generic auto-audit. */
  @Patch(':id/active')
  @Roles(Role.TENANT_ADMIN)
  @SkipAudit()
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return this.users.setActive(id, dto.isActive);
  }
}
