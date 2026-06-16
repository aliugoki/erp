import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MoneyDto {
  @IsInt()
  @Min(0)
  amountMinor!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;
}

export class CreateEmployeeDto {
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() positionId?: string;
  @IsOptional() @IsISO8601() joinDate?: string;
  @IsOptional() @ValidateNested() @Type(() => MoneyDto) salary?: MoneyDto;
  @IsOptional() @IsIn(['ACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: string;
  /** Optional explicit code; auto-generated if omitted. */
  @IsOptional() @IsString() employeeCode?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(1) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) lastName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() positionId?: string;
  @IsOptional() @ValidateNested() @Type(() => MoneyDto) salary?: MoneyDto;
  @IsOptional() @IsIn(['ACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: string;
}

export class ListEmployeesQueryDto {
  @IsOptional() @IsUUID() department?: string;
  @IsOptional() @IsIn(['ACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

export class CreateDepartmentDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsUUID() parentDepartmentId?: string;
}

export class CreatePositionDto {
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateAttendanceDto {
  @IsUUID() employeeId!: string;
  @IsISO8601() date!: string;
  @IsOptional() @IsISO8601() checkIn?: string;
  @IsOptional() @IsISO8601() checkOut?: string;
  @IsOptional() @IsIn(['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY']) status?: string;
}

// ── Leave management ────────────────────────────────────────────────────────────
export class CreateLeaveTypeDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(0) daysPerYear?: number;
  @IsOptional() @IsBoolean() paid?: boolean;
  @IsOptional() @IsString() color?: string;
}

export class SetLeaveBalanceDto {
  @IsUUID() employeeId!: string;
  @IsUUID() leaveTypeId!: string;
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(0) entitledDays!: number;
}

export class CreateLeaveRequestDto {
  @IsUUID() employeeId!: string;
  @IsUUID() leaveTypeId!: string;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
  @IsOptional() @IsString() reason?: string;
}

export class DecideLeaveDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: string;
  @IsOptional() @IsString() note?: string;
}

// ── Payroll ─────────────────────────────────────────────────────────────────────
export class CreateSalaryComponentDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) code!: string;
  @IsIn(['EARNING', 'DEDUCTION']) type!: string;
  @IsIn(['FIXED', 'PCT_OF_BASIC']) calc!: string;
  @IsOptional() @IsInt() @Min(0) valueMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) percent?: number;
}

export class CreatePayrollRunDto {
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
}

// ── Performance ───────────────────────────────────────────────────────────────────
export class CreateReviewDto {
  @IsUUID() employeeId!: string;
  @IsString() @MinLength(1) period!: string;
  @IsOptional() @IsUUID() reviewerId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsString() strengths?: string;
  @IsOptional() @IsString() improvements?: string;
}

export class CreateGoalDto {
  @IsUUID() employeeId!: string;
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsISO8601() targetDate?: string;
}

export class UpdateGoalDto {
  @IsOptional() @IsIn(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) status?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────
export class CreateDocumentDto {
  @IsUUID() employeeId!: string;
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() docType?: string;
  @IsOptional() @IsString() fileRef?: string;
  @IsOptional() @IsString() note?: string;
}

/** A lifecycle change (promotion, transfer, salary revision, …) that updates the employee and writes
 * an audit row in one transaction. */
export class LifecycleEventDto {
  @IsIn(['PROMOTED', 'TRANSFERRED', 'SALARY_CHANGE', 'STATUS_CHANGE', 'OTHER']) eventType!: string;
  @IsOptional() @IsISO8601() effectiveDate?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() positionId?: string;
  @IsOptional() @ValidateNested() @Type(() => MoneyDto) salary?: MoneyDto;
  @IsOptional() @IsIn(['ACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: string;
  @IsOptional() @IsString() note?: string;
}
