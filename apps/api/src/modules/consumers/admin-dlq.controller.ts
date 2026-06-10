import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { DlqService } from './dlq.service';

/** Inspect and requeue dead-lettered events for the current tenant (TENANT_ADMIN). */
@Controller('admin/dlq')
@Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
export class AdminDlqController {
  constructor(private readonly dlq: DlqService) {}

  @Get()
  list() {
    return this.dlq.list();
  }

  @Post(':id/requeue')
  @HttpCode(HttpStatus.OK)
  async requeue(@Param('id', ParseUUIDPipe) id: string) {
    await this.dlq.requeue(id);
    return { requeued: id };
  }
}
