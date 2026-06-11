import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { ProfitLossQueryDto } from './dto/reports.dto';
import { ReportingService } from './reporting.service';

/**
 * Cross-module reports (Chunk 5.2). Every response is `{ raw, series }` and tenant-scoped (served from
 * the per-tenant read models). Auth + tenant guards apply globally; the on-demand refresh is admin-only.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('finance/profit-loss')
  financeProfitLoss(@Query() q: ProfitLossQueryDto) {
    return this.reporting.financeProfitLoss(q.from, q.to);
  }

  @Get('inventory/valuation')
  inventoryValuation() {
    return this.reporting.inventoryValuation();
  }

  @Get('hr/headcount')
  hrHeadcount() {
    return this.reporting.hrHeadcount();
  }

  @Get('crm/sales-pipeline')
  crmSalesPipeline() {
    return this.reporting.crmSalesPipeline();
  }

  /** Recompute this tenant's read models now (the schedule does this automatically in production). */
  @Post('refresh')
  @Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  refresh() {
    return this.reporting.refreshCurrent();
  }
}
