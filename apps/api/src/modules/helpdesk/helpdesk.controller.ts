import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  AssignTicketDto, CreateTicketDto, CsatDto, ReplyDto, SetStatusDto,
  UpdateTicketDto, UpsertCannedResponseDto, UpsertSlaPolicyDto, UpsertTeamDto,
} from './dto/helpdesk.dto';
import { HelpdeskService } from './helpdesk.service';

const AGENT = [Role.SUPPORT_AGENT, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;
const ADMIN = [Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Help Desk agent console — gated by the `helpdesk` feature entitlement (ADR-009). */
@Controller('helpdesk')
@RequiresFeature('helpdesk')
export class HelpdeskController {
  constructor(private readonly hd: HelpdeskService) {}

  // ── Tickets ───────────────────────────────────────────────────────────────────
  @Get('tickets')
  list(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('teamId') teamId?: string,
    @Query('q') q?: string,
    @Query('breached') breached?: string,
    @Query('unassigned') unassigned?: string,
  ) {
    return this.hd.listTickets({ status, priority, assignedTo, teamId, q, breached: breached === 'true', unassigned: unassigned === 'true' });
  }

  @Get('overview')
  overview() {
    return this.hd.overview();
  }

  @Get('agents')
  agents() {
    return this.hd.listAgents();
  }

  @Get('tickets/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.hd.getTicket(id);
  }

  @Post('tickets')
  @Roles(...AGENT)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hd.createTicket(dto, user.userId);
  }

  @Patch('tickets/:id')
  @Roles(...AGENT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return this.hd.updateTicket(id, dto);
  }

  @Post('tickets/:id/reply')
  @Roles(...AGENT)
  @HttpCode(HttpStatus.OK)
  reply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hd.reply(id, dto, user.userId);
  }

  @Post('tickets/:id/assign')
  @Roles(...AGENT)
  @HttpCode(HttpStatus.OK)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hd.assign(id, dto, user.userId);
  }

  @Post('tickets/:id/status')
  @Roles(...AGENT)
  @HttpCode(HttpStatus.OK)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hd.setStatus(id, dto, user.userId);
  }

  @Post('tickets/:id/csat')
  @Roles(...AGENT)
  @HttpCode(HttpStatus.OK)
  csat(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CsatDto) {
    return this.hd.setCsat(id, dto);
  }

  @Post('sla/sweep')
  @Roles(...ADMIN)
  @HttpCode(HttpStatus.OK)
  sweep() {
    return this.hd.sweepBreaches();
  }

  // ── Teams ─────────────────────────────────────────────────────────────────────
  @Get('teams')
  listTeams() {
    return this.hd.listTeams();
  }

  @Post('teams')
  @Roles(...ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createTeam(@Body() dto: UpsertTeamDto) {
    return this.hd.createTeam(dto);
  }

  @Patch('teams/:id')
  @Roles(...ADMIN)
  updateTeam(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertTeamDto) {
    return this.hd.updateTeam(id, dto);
  }

  @Delete('teams/:id')
  @Roles(...ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTeam(@Param('id', ParseUUIDPipe) id: string) {
    return this.hd.deleteTeam(id);
  }

  // ── SLA policies ────────────────────────────────────────────────────────────────
  @Get('sla-policies')
  listSla() {
    return this.hd.listSlaPolicies();
  }

  @Put('sla-policies')
  @Roles(...ADMIN)
  @HttpCode(HttpStatus.OK)
  upsertSla(@Body() dto: UpsertSlaPolicyDto) {
    return this.hd.upsertSlaPolicy(dto);
  }

  // ── Canned responses ──────────────────────────────────────────────────────────
  @Get('canned-responses')
  listCanned() {
    return this.hd.listCanned();
  }

  @Post('canned-responses')
  @Roles(...AGENT)
  @HttpCode(HttpStatus.CREATED)
  createCanned(@Body() dto: UpsertCannedResponseDto) {
    return this.hd.createCanned(dto);
  }

  @Delete('canned-responses/:id')
  @Roles(...AGENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCanned(@Param('id', ParseUUIDPipe) id: string) {
    return this.hd.deleteCanned(id);
  }
}
