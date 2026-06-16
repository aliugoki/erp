import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CreateReportDto, ProfitLossQueryDto, RunReportDto } from './dto/reports.dto';
import { ReportBuilderService } from './report-builder.service';
import { ReportingService } from './reporting.service';

const WRITE = [Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/**
 * Cross-module reports (Chunk 5.2). Every response is `{ raw, series }` and tenant-scoped (served from
 * the per-tenant read models). Auth + tenant guards apply globally; the on-demand refresh is admin-only.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly builder: ReportBuilderService,
  ) {}

  // ── Report builder (preset + custom) ────────────────────────────────────────
  @Get('builder/datasets')
  @RequiresFeature('reporting')
  datasets() {
    return this.builder.datasets();
  }

  @Get('builder/presets')
  @RequiresFeature('reporting')
  presets() {
    return this.builder.presets();
  }

  @Post('builder/run')
  @RequiresFeature('reporting')
  @HttpCode(HttpStatus.OK)
  runAdHoc(@Body() dto: RunReportDto) {
    return this.builder.runAdHoc(dto);
  }

  @Get('builder/presets/:key/run')
  @RequiresFeature('reporting')
  runPreset(@Param('key') key: string) {
    return this.builder.runPreset(key);
  }

  @Get('builder/custom')
  @RequiresFeature('reporting')
  listReports() {
    return this.builder.listReports();
  }

  @Post('builder/custom')
  @RequiresFeature('reporting')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createReport(@Body() dto: CreateReportDto) {
    return this.builder.createReport(dto);
  }

  @Get('builder/custom/:id/run')
  @RequiresFeature('reporting')
  runSaved(@Param('id', ParseUUIDPipe) id: string) {
    return this.builder.runSaved(id);
  }

  @Delete('builder/custom/:id')
  @RequiresFeature('reporting')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.builder.deleteReport(id);
  }

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
