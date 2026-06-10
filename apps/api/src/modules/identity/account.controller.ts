import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { Role } from '../auth/rbac/role.enum';

/**
 * Identity endpoints. `/me` returns the authenticated principal (any logged-in user). The `/admin/*`
 * probes demonstrate (and let the gate verify) the role and permission guards.
 */
@Controller()
export class AccountController {
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Get('admin/ping')
  @Roles(Role.SUPER_ADMIN, Role.TENANT_ADMIN)
  adminPing(): { ok: true } {
    return { ok: true };
  }

  @Get('admin/perm-ping')
  @Permissions('hr:employee:write')
  permPing(): { ok: true } {
    return { ok: true };
  }
}
