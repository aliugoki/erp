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
import { ToggleFeatureDto } from '../features/dto/toggle-feature.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantPlanDto } from './dto/update-tenant-plan.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { TenantsService } from './tenants.service';

/** Tenant provisioning & management — platform operations, restricted to SUPER_ADMIN. */
@Controller('tenants')
@Roles(Role.SUPER_ADMIN)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  // NOTE: declared before `:id` so the literal path isn't captured by the UUID param route.
  @Get('stats')
  stats() {
    return this.tenants.stats();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  provision(@Body() dto: CreateTenantDto) {
    return this.tenants.provision(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.findById(id);
  }

  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.rename(id, dto.name);
  }

  @Patch(':id/status')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.tenants.setStatus(id, dto.status);
  }

  @Patch(':id/plan')
  setPlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantPlanDto) {
    return this.tenants.applyPlanToTenant(id, dto.plan);
  }

  /** The company's module/feature entitlements (managed by the platform, not the company). */
  @Get(':id/features')
  listFeatures(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.listFeatures(id);
  }

  @Patch(':id/features/:key')
  setFeature(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: ToggleFeatureDto,
  ) {
    return this.tenants.setFeature(id, key, dto.enabled);
  }

  @Get(':id/users')
  listUsers(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.listUsers(id);
  }

  @Post(':id/users')
  @HttpCode(HttpStatus.CREATED)
  addUser(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateTenantUserDto) {
    return this.tenants.addUser(id, dto);
  }

  @Patch(':id/users/:userId/password')
  resetUserPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.tenants.resetUserPassword(id, userId, dto.newPassword);
  }

  @Patch(':id/users/:userId/status')
  setUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.tenants.setUserStatus(id, userId, dto.isActive);
  }
}
