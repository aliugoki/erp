import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { SkipAudit } from '../audit/skip-audit.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetActiveDto } from './dto/set-active.dto';
import { SetRolesDto } from './dto/set-roles.dto';
import { UsersService } from './users.service';

/** User management, tenant-scoped by RLS. Mutations require TENANT_ADMIN (a company manages its own
 * users); a cross-tenant id simply returns 404. */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** List the caller's own company's users (TENANT_ADMIN). */
  @Get()
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  list() {
    return this.users.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findByIdInTenant(id);
  }

  /** Add a user to the caller's own company (TENANT_ADMIN). */
  @Post()
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUserDto) {
    return this.users.create({ email: dto.email, password: dto.password, roles: dto.roles });
  }

  /** Replace a user's roles (TENANT_ADMIN). */
  @Patch(':id/roles')
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  setRoles(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolesDto) {
    return this.users.setRoles(id, dto.roles);
  }

  /** Reset a user's password (TENANT_ADMIN); their sessions are revoked. */
  @Patch(':id/password')
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(id, dto.newPassword);
  }

  /** Activate/deactivate a user (TENANT_ADMIN). Records its own before/after audit, so it opts out
   * of the generic auto-audit. */
  @Patch(':id/active')
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  @SkipAudit()
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return this.users.setActive(id, dto.isActive);
  }
}
