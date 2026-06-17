import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Min, MinLength } from 'class-validator';

const BILLING = ['FIXED', 'TIME_MATERIALS', 'NON_BILLABLE'] as const;

// ── Projects ────────────────────────────────────────────────────────────────
export class CreateProjectDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() managerEmployeeId?: string;
  @IsOptional() @IsIn(BILLING as unknown as string[]) billingType?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsInt() @Min(0) budgetMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() description?: string;
}
export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() managerEmployeeId?: string;
  @IsOptional() @IsIn(BILLING as unknown as string[]) billingType?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsInt() @Min(0) budgetMinor?: number;
  @IsOptional() @IsString() description?: string;
}
export class ProjectStatusDto {
  @IsIn(['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']) status!: string;
}

// ── Members ─────────────────────────────────────────────────────────────────
export class AddMemberDto {
  @IsUUID() employeeId!: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsInt() @Min(0) costRateMinor?: number;
  @IsOptional() @IsInt() @Min(0) billRateMinor?: number;
}

// ── Tasks ───────────────────────────────────────────────────────────────────
export class CreateTaskDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsUUID() assigneeEmployeeId?: string;
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
  @IsOptional() @IsInt() @Min(0) estimateMinutes?: number;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsString() description?: string;
}
export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsUUID() assigneeEmployeeId?: string;
  @IsOptional() @IsIn(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']) status?: string;
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
  @IsOptional() @IsInt() @Min(0) estimateMinutes?: number;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsString() description?: string;
}

// ── Time entries ────────────────────────────────────────────────────────────
export class LogTimeDto {
  @IsUUID() employeeId!: string;
  @IsOptional() @IsUUID() taskId?: string;
  @IsOptional() @IsISO8601() entryDate?: string;
  @IsInt() @Min(1) minutes!: number;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() description?: string;
}
export class TimeStatusDto {
  @IsIn(['SUBMITTED', 'APPROVED', 'REJECTED', 'DRAFT']) status!: string;
}

// ── Expenses ────────────────────────────────────────────────────────────────
export class CreateExpenseDto {
  @IsOptional() @IsISO8601() expenseDate?: string;
  @IsOptional() @IsString() category?: string;
  @IsInt() @Min(0) amountMinor!: number;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsString() description?: string;
}
