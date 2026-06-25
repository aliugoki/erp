import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  AssignTicketDto, CreateTicketDto, CsatDto, ReplyDto, SetStatusDto,
  UpdateTicketDto, UpsertCannedResponseDto, UpsertSlaPolicyDto, UpsertTeamDto,
} from './dto/helpdesk.dto';
import { HelpdeskService } from './helpdesk.service';


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
  @Permissions('helpdesk:ticket:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hd.createTicket(dto, user.userId);
  }

  @Patch('tickets/:id')
  @Permissions('helpdesk:ticket:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return this.hd.updateTicket(id, dto);
  }

  @Post('tickets/:id/reply')
  @Permissions('helpdesk:ticket:write')
  @HttpCode(HttpStatus.OK)
  reply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hd.reply(id, dto, user.userId);
  }

  @Post('tickets/:id/assign')
  @Permissions('helpdesk:ticket:write')
  @HttpCode(HttpStatus.OK)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hd.assign(id, dto, user.userId);
  }

  @Post('tickets/:id/status')
  @Permissions('helpdesk:ticket:write')
  @HttpCode(HttpStatus.OK)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hd.setStatus(id, dto, user.userId);
  }

  @Post('tickets/:id/csat')
  @Permissions('helpdesk:ticket:write')
  @HttpCode(HttpStatus.OK)
  csat(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CsatDto) {
    return this.hd.setCsat(id, dto);
  }

  @Post('sla/sweep')
  @Permissions('helpdesk:config:write')
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
  @Permissions('helpdesk:config:write')
  @HttpCode(HttpStatus.CREATED)
  createTeam(@Body() dto: UpsertTeamDto) {
    return this.hd.createTeam(dto);
  }

  @Patch('teams/:id')
  @Permissions('helpdesk:config:write')
  updateTeam(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertTeamDto) {
    return this.hd.updateTeam(id, dto);
  }

  @Delete('teams/:id')
  @Permissions('helpdesk:config:write')
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
  @Permissions('helpdesk:config:write')
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
  @Permissions('helpdesk:ticket:write')
  @HttpCode(HttpStatus.CREATED)
  createCanned(@Body() dto: UpsertCannedResponseDto) {
    return this.hd.createCanned(dto);
  }

  @Delete('canned-responses/:id')
  @Permissions('helpdesk:ticket:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCanned(@Param('id', ParseUUIDPipe) id: string) {
    return this.hd.deleteCanned(id);
  }
}
