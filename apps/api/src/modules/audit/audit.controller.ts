import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditService } from './audit.service';

/**
 * Audit-log viewer (read-only). Surfaces the tenant-scoped audit trail captured by the auto-audit
 * interceptor + explicit before/after records. Admin-only — audit is sensitive. RLS scopes every row
 * to the caller's tenant.
 */
@Controller('audit')
@Roles(Role.SUPER_ADMIN, Role.TENANT_ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('logs')
  logs(@Query() q: AuditQueryDto) {
    return this.audit.listForTenant(q);
  }
}
