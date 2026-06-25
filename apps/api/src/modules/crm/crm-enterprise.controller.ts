import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CrmEnterpriseService } from './crm-enterprise.service';
import {
  CompleteActivityDto,
  ConvertLeadDto,
  CreateActivityDto,
  CreateLeadDto,
  ListActivityQueryDto,
  UpdateActivityDto,
  UpdateLeadDto,
  UpdateLeadStatusDto,
} from './dto/crm.dto';


/** Enterprise CRM routes — leads, activities and sales reports. Shares the `crm` feature gate and
 * the `/crm` prefix with {@link CrmController}; writes require a sales rep (or admin). */
@Controller('crm')
@RequiresFeature('crm')
export class CrmEnterpriseController {
  constructor(private readonly crm: CrmEnterpriseService) {}

  // ── Leads ───────────────────────────────────────────────────────────────────
  @Get('leads')
  listLeads() {
    return this.crm.listLeads();
  }

  @Post('leads')
  @Permissions('crm:lead:write')
  @HttpCode(HttpStatus.CREATED)
  createLead(@Body() dto: CreateLeadDto) {
    return this.crm.createLead(dto);
  }

  @Get('leads/:id')
  getLead(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getLead(id);
  }

  @Patch('leads/:id/status')
  @Permissions('crm:lead:write')
  updateLeadStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.crm.updateLeadStatus(id, dto.status);
  }

  @Post('leads/:id/convert')
  @Permissions('crm:lead:write')
  convertLead(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertLeadDto) {
    return this.crm.convertLead(id, dto);
  }

  @Patch('leads/:id')
  @Permissions('crm:lead:write')
  updateLead(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.crm.updateLead(id, dto);
  }

  @Delete('leads/:id')
  @Permissions('crm:lead:write')
  @HttpCode(HttpStatus.OK)
  deleteLead(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.deleteLead(id);
  }

  // ── Activities / tasks ────────────────────────────────────────────────────────
  @Get('activities')
  listActivities(@Query() q: ListActivityQueryDto) {
    return this.crm.listActivities(q);
  }

  /** Open tasks (with a due date) — declared before `:id` routes so it isn't shadowed. */
  @Get('activities/open')
  openTasks() {
    return this.crm.listOpenTasks();
  }

  @Post('activities')
  @Permissions('crm:activity:write')
  @HttpCode(HttpStatus.CREATED)
  createActivity(@Body() dto: CreateActivityDto) {
    return this.crm.createActivity(dto);
  }

  @Patch('activities/:id/complete')
  @Permissions('crm:activity:write')
  completeActivity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteActivityDto) {
    return this.crm.completeActivity(id, dto.outcome ?? null);
  }

  @Patch('activities/:id')
  @Permissions('crm:activity:write')
  updateActivity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateActivityDto) {
    return this.crm.updateActivity(id, dto);
  }

  @Delete('activities/:id')
  @Permissions('crm:activity:write')
  @HttpCode(HttpStatus.OK)
  deleteActivity(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.deleteActivity(id);
  }

  // ── Sales reports ─────────────────────────────────────────────────────────────
  @Get('reports/forecast')
  forecast() {
    return this.crm.forecast();
  }

  @Get('reports/win-loss')
  winLoss() {
    return this.crm.winLoss();
  }

  @Get('reports/sales-by-owner')
  salesByOwner() {
    return this.crm.salesByOwner();
  }

  @Get('reports/lead-funnel')
  leadFunnel() {
    return this.crm.leadFunnel();
  }
}
