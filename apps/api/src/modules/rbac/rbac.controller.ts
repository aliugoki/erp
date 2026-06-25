import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { Role } from '../auth/rbac/role.enum';
import { CustomRoleDto } from './dto/custom-role.dto';
import { RbacService } from './rbac.service';

/**
 * Company-admin RBAC: a TENANT_ADMIN manages their own company's custom (composite) roles. All
 * operations run in the caller's tenant context (RLS-scoped), so one company can never touch another.
 */
@Controller('tenant/roles')
@Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  /** The built-in capability building blocks a custom role can combine. */
  @Get('capabilities')
  capabilities() {
    return this.rbac.capabilities();
  }

  /** Path 2: the fine-grained permission catalog (grouped) + the caller's effective permissions. */
  @Get('permissions')
  permissions(@CurrentUser() user: AuthenticatedUser | undefined) {
    return { catalog: this.rbac.permissionCatalog(), mine: user?.perms ?? [] };
  }

  @Get()
  list() {
    return this.rbac.listCustom();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CustomRoleDto) {
    return this.rbac.createCustom({
      name: dto.name,
      description: dto.description,
      memberRoles: dto.memberRoles ?? [],
      permissions: dto.permissions ?? [],
    });
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomRoleDto) {
    return this.rbac.updateCustom(id, {
      name: dto.name,
      description: dto.description,
      memberRoles: dto.memberRoles ?? [],
      permissions: dto.permissions ?? [],
    });
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.deleteCustom(id);
  }
}
