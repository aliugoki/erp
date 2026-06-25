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
import { ProjectsService } from './projects.service';
import {
  AddMemberDto,
  CreateExpenseDto,
  CreateProjectDto,
  CreateTaskDto,
  LogTimeDto,
  ProjectStatusDto,
  TimeStatusDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './dto/projects.dto';

/** Project writes require a manager or admin. */

/** Project Management & Timesheets — gated by the `projects` feature entitlement. */
@Controller('projects')
@RequiresFeature('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // ── Reports (declared before :id) ─────────────────────────────────────────────
  @Get('reports/portfolio')
  portfolio() {
    return this.projects.portfolio();
  }

  @Get('reports/timesheet')
  timesheet(@Query('from') from?: string, @Query('to') to?: string) {
    return this.projects.timesheetSummary(from, to);
  }

  // ── Projects ────────────────────────────────────────────────────────────────
  @Get()
  list(@Query('status') status?: string) {
    return this.projects.listProjects(status);
  }

  @Post()
  @Permissions('project:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto) {
    return this.projects.createProject(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.getProject(id);
  }

  @Patch(':id')
  @Permissions('project:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.updateProject(id, dto);
  }

  @Patch(':id/status')
  @Permissions('project:write')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProjectStatusDto) {
    return this.projects.setStatus(id, dto.status);
  }

  @Delete(':id')
  @Permissions('project:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.deleteProject(id);
  }

  // ── Members ─────────────────────────────────────────────────────────────────
  @Get(':id/members')
  listMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listMembers(id);
  }

  @Post(':id/members')
  @Permissions('project:write')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.projects.addMember(id, dto);
  }

  @Delete(':id/members/:memberId')
  @Permissions('project:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.projects.removeMember(id, memberId);
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────
  @Get(':id/tasks')
  listTasks(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listTasks(id);
  }

  @Post(':id/tasks')
  @Permissions('project:write')
  @HttpCode(HttpStatus.CREATED)
  createTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateTaskDto) {
    return this.projects.createTask(id, dto);
  }

  @Patch(':id/tasks/:taskId')
  @Permissions('project:write')
  updateTask(@Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: UpdateTaskDto) {
    return this.projects.updateTask(id, taskId, dto);
  }

  @Delete(':id/tasks/:taskId')
  @Permissions('project:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTask(@Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.projects.deleteTask(id, taskId);
  }

  // ── Time entries ────────────────────────────────────────────────────────────
  @Get(':id/time')
  listTime(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listTime(id);
  }

  @Post(':id/time')
  @Permissions('project:write')
  @HttpCode(HttpStatus.CREATED)
  logTime(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LogTimeDto) {
    return this.projects.logTime(id, dto);
  }

  @Patch(':id/time/:entryId/status')
  @Permissions('project:write')
  setTimeStatus(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() dto: TimeStatusDto) {
    return this.projects.setTimeStatus(id, entryId, dto.status);
  }

  @Delete(':id/time/:entryId')
  @Permissions('project:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTime(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string) {
    return this.projects.deleteTime(id, entryId);
  }

  // ── Expenses ──────────────────────────────────────────────────────────────────
  @Get(':id/expenses')
  listExpenses(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listExpenses(id);
  }

  @Post(':id/expenses')
  @Permissions('project:write')
  @HttpCode(HttpStatus.CREATED)
  addExpense(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateExpenseDto) {
    return this.projects.addExpense(id, dto);
  }

  @Delete(':id/expenses/:expenseId')
  @Permissions('project:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteExpense(@Param('id', ParseUUIDPipe) id: string, @Param('expenseId', ParseUUIDPipe) expenseId: string) {
    return this.projects.deleteExpense(id, expenseId);
  }
}
