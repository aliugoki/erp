import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { Role } from '../auth/rbac/role.enum';

/**
 * Identity endpoints. `/me` returns the authenticated principal (any logged-in user). The `/admin/*`
 * probes demonstrate (and let the gate verify) the role and permission guards.
 */
@Controller()
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /** Change your own password (any authenticated user, including SUPER_ADMIN). */
  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user.userId, user.tenantId, dto.currentPassword, dto.newPassword);
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
