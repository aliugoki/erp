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
import { HrEnterpriseService } from './hr-enterprise.service';
import {
  AttendanceQueryDto,
  BulkAttendanceDto,
  CreateDocumentDto,
  CreateGoalDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  CreatePayrollRunDto,
  CreateReviewDto,
  CreateSalaryComponentDto,
  DecideLeaveDto,
  LifecycleEventDto,
  LogAttendanceDto,
  SetLeaveBalanceDto,
  UpdateGoalDto,
} from './dto/hr.dto';

const WRITE = [Role.HR_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Enterprise HCM routes — leave, payroll, performance, lifecycle and HR reports. Shares the `hr`
 * feature gate and the `/hr` prefix with {@link HrController}; writes require an HR manager (or admin). */
@Controller('hr')
@RequiresFeature('hr')
export class HrEnterpriseController {
  constructor(private readonly hr: HrEnterpriseService) {}

  // ── Leave ───────────────────────────────────────────────────────────────────
  @Get('leave-types')
  listLeaveTypes() {
    return this.hr.listLeaveTypes();
  }

  @Post('leave-types')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createLeaveType(@Body() dto: CreateLeaveTypeDto) {
    return this.hr.createLeaveType(dto);
  }

  @Post('leave-balances')
  @Roles(...WRITE)
  setLeaveBalance(@Body() dto: SetLeaveBalanceDto) {
    return this.hr.setLeaveBalance(dto);
  }

  @Get('leave-balances/:employeeId')
  listLeaveBalances(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.hr.listLeaveBalances(employeeId);
  }

  @Get('leave-requests')
  listLeaveRequests(@Query('status') status?: string) {
    return this.hr.listLeaveRequests(status);
  }

  @Post('leave-requests')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createLeaveRequest(@Body() dto: CreateLeaveRequestDto) {
    return this.hr.createLeaveRequest(dto);
  }

  @Patch('leave-requests/:id/decide')
  @Roles(...WRITE)
  decideLeave(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideLeaveDto) {
    return this.hr.decideLeave(id, dto);
  }

  // ── Payroll ───────────────────────────────────────────────────────────────────
  @Get('salary-components')
  listComponents() {
    return this.hr.listComponents();
  }

  @Post('salary-components')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createComponent(@Body() dto: CreateSalaryComponentDto) {
    return this.hr.createComponent(dto);
  }

  @Get('payroll/runs')
  listRuns() {
    return this.hr.listPayrollRuns();
  }

  @Post('payroll/runs')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createRun(@Body() dto: CreatePayrollRunDto) {
    return this.hr.createPayrollRun(dto);
  }

  @Patch('payroll/runs/:id/approve')
  @Roles(...WRITE)
  approveRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.updateRunStatus(id, 'APPROVED');
  }

  @Patch('payroll/runs/:id/pay')
  @Roles(...WRITE)
  payRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.updateRunStatus(id, 'PAID');
  }

  @Get('payroll/runs/:id/payslips')
  listPayslips(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.listPayslips(id);
  }

  @Get('payslips/:id')
  getPayslip(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.getPayslip(id);
  }

  // ── Performance ─────────────────────────────────────────────────────────────────
  @Get('reviews')
  listReviews(@Query('employeeId') employeeId?: string) {
    return this.hr.listReviews(employeeId);
  }

  @Post('reviews')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createReview(@Body() dto: CreateReviewDto) {
    return this.hr.createReview(dto);
  }

  @Patch('reviews/:id/submit')
  @Roles(...WRITE)
  submitReview(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.submitReview(id);
  }

  @Get('goals')
  listGoals(@Query('employeeId') employeeId?: string) {
    return this.hr.listGoals(employeeId);
  }

  @Post('goals')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createGoal(@Body() dto: CreateGoalDto) {
    return this.hr.createGoal(dto);
  }

  @Patch('goals/:id')
  @Roles(...WRITE)
  updateGoal(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGoalDto) {
    return this.hr.updateGoal(id, dto);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────────
  @Post('employees/:id/lifecycle')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  lifecycle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LifecycleEventDto) {
    return this.hr.recordLifecycleEvent(id, dto);
  }

  @Get('employees/:id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.listHistory(id);
  }

  @Post('documents')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  addDocument(@Body() dto: CreateDocumentDto) {
    return this.hr.addDocument(dto);
  }

  @Get('documents/:employeeId')
  listDocuments(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.hr.listDocuments(employeeId);
  }

  // ── Attendance (enterprise) ───────────────────────────────────────────────────
  // Hyphenated paths so they don't collide with the core `attendance/:employeeId` route.
  @Post('attendance-log')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  logAttendance(@Body() dto: LogAttendanceDto) {
    return this.hr.logAttendance(dto);
  }

  @Post('attendance-bulk')
  @Roles(...WRITE)
  bulkAttendance(@Body() dto: BulkAttendanceDto) {
    return this.hr.bulkLogAttendance(dto);
  }

  @Get('attendance-day')
  dayAttendance(@Query('date') date: string) {
    return this.hr.dayAttendance(date);
  }

  @Get('attendance-summary')
  attendanceSummary(@Query() q: AttendanceQueryDto) {
    return this.hr.attendanceSummary(q);
  }

  // ── Reports ───────────────────────────────────────────────────────────────────
  @Get('reports/headcount')
  headcount() {
    return this.hr.headcount();
  }

  @Get('reports/payroll')
  payrollSummary() {
    return this.hr.payrollSummary();
  }

  @Get('reports/leave')
  leaveSummary() {
    return this.hr.leaveSummary();
  }
}
