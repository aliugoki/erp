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
  StreamableFile,
} from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CreateReportDto, ProfitLossQueryDto, RunReportDto } from './dto/reports.dto';
import { ReportBuilderService } from './report-builder.service';
import { ReportingService } from './reporting.service';
import { FORMAT_META, type ReportFormat, renderReport } from './report-export';

interface RunResult {
  title?: string;
  columns: Array<{ key: string; label: string; money?: boolean }>;
  rows: Array<Record<string, unknown>>;
}

const EXPORT_FORMATS: ReportFormat[] = ['csv', 'xlsx', 'pdf'];
function slugifyFile(s: string): string {
  return (s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';
}


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
  async runAdHoc(@Body() dto: RunReportDto, @Query('format') format?: string) {
    return this.respond(await this.builder.runAdHoc(dto), format);
  }

  @Get('builder/presets/:key/run')
  @RequiresFeature('reporting')
  async runPreset(@Param('key') key: string, @Query('format') format?: string) {
    return this.respond(await this.builder.runPreset(key), format);
  }

  @Get('builder/custom')
  @RequiresFeature('reporting')
  listReports() {
    return this.builder.listReports();
  }

  @Post('builder/custom')
  @RequiresFeature('reporting')
  @Permissions('report:write')
  @HttpCode(HttpStatus.CREATED)
  createReport(@Body() dto: CreateReportDto) {
    return this.builder.createReport(dto);
  }

  @Get('builder/custom/:id/run')
  @RequiresFeature('reporting')
  async runSaved(@Param('id', ParseUUIDPipe) id: string, @Query('format') format?: string) {
    return this.respond(await this.builder.runSaved(id), format);
  }

  /** Return JSON (default) or, when `?format=csv|xlsx|pdf`, a streamed downloadable file. */
  private async respond(result: RunResult, format?: string): Promise<RunResult | StreamableFile> {
    if (!format) return result;
    if (!EXPORT_FORMATS.includes(format as ReportFormat)) return result;
    const fmt = format as ReportFormat;
    const buf = await renderReport(fmt, {
      title: result.title ?? 'Report',
      columns: result.columns,
      rows: result.rows,
    });
    const { type, ext } = FORMAT_META[fmt];
    return new StreamableFile(buf, {
      type,
      disposition: `attachment; filename="${slugifyFile(result.title ?? 'report')}.${ext}"`,
    });
  }

  @Delete('builder/custom/:id')
  @RequiresFeature('reporting')
  @Permissions('report:write')
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
  @Permissions('report:write')
  @HttpCode(HttpStatus.OK)
  refresh() {
    return this.reporting.refreshCurrent();
  }
}
