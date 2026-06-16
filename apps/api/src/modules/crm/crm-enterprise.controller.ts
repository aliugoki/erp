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
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CrmEnterpriseService } from './crm-enterprise.service';
import {
  CompleteActivityDto,
  ConvertLeadDto,
  CreateActivityDto,
  CreateLeadDto,
  ListActivityQueryDto,
  UpdateLeadStatusDto,
} from './dto/crm.dto';

const WRITE = [Role.SALES_REP, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

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
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createLead(@Body() dto: CreateLeadDto) {
    return this.crm.createLead(dto);
  }

  @Get('leads/:id')
  getLead(@Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getLead(id);
  }

  @Patch('leads/:id/status')
  @Roles(...WRITE)
  updateLeadStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.crm.updateLeadStatus(id, dto.status);
  }

  @Post('leads/:id/convert')
  @Roles(...WRITE)
  convertLead(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertLeadDto) {
    return this.crm.convertLead(id, dto);
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
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createActivity(@Body() dto: CreateActivityDto) {
    return this.crm.createActivity(dto);
  }

  @Patch('activities/:id/complete')
  @Roles(...WRITE)
  completeActivity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteActivityDto) {
    return this.crm.completeActivity(id, dto.outcome ?? null);
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
