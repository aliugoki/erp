import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantsService } from './tenants.service';

/** Tenant provisioning — platform operations, restricted to SUPER_ADMIN. */
@Controller('tenants')
@Roles(Role.SUPER_ADMIN)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  provision(@Body() dto: CreateTenantDto) {
    return this.tenants.provision(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.findById(id);
  }
}
