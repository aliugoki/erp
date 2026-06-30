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

/** Optional personal/contact/job profile fields shared by create + profile update. */
export class EmployeeProfileFieldsDto {
  @IsOptional() @IsISO8601() dateOfBirth?: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) gender?: string;
  @IsOptional() @IsString() maritalStatus?: string;
  @IsOptional() @IsString() nationalId?: string;
  @IsOptional() @IsString() bloodGroup?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() emergencyContactName?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'PROBATION']) employmentType?: string;
  @IsOptional() @IsUUID() reportingTo?: string;
  @IsOptional() @IsISO8601() confirmationDate?: string;
  @IsOptional() @IsString() workLocation?: string;
  /** Attachment id of the employee photo; normally set via the photo-upload endpoint, not raw. */
  @IsOptional() @IsUUID() photoRef?: string;
}

export class CreateEmployeeDto extends EmployeeProfileFieldsDto {
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

/** Update the extended profile (personal/contact/job) of an existing employee. */
export class UpdateEmployeeProfileDto extends EmployeeProfileFieldsDto {}

export class CreateEducationDto {
  @IsString() @MinLength(1) degree!: string;
  @IsOptional() @IsString() institution?: string;
  @IsOptional() @IsString() fieldOfStudy?: string;
  @IsOptional() @IsInt() @Min(1900) @Max(2100) startYear?: number;
  @IsOptional() @IsInt() @Min(1900) @Max(2100) endYear?: number;
  @IsOptional() @IsString() grade?: string;
}

export class CreateExperienceDto {
  @IsString() @MinLength(1) company!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsString() description?: string;
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

export class UpdateDepartmentDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsUUID() parentDepartmentId?: string;
}

export class CreatePositionDto {
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateDesignationDto {
  @IsString() @MinLength(1) name!: string;
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

// ── Partial-update DTOs (every field optional) for the org + payroll reference lists ──
export class UpdatePositionDto {
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdateDesignationDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdateLeaveTypeDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(0) daysPerYear?: number;
  @IsOptional() @IsBoolean() paid?: boolean;
  @IsOptional() @IsString() color?: string;
}

export class UpdateSalaryComponentDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) code?: string;
  @IsOptional() @IsIn(['EARNING', 'DEDUCTION']) type?: string;
  @IsOptional() @IsIn(['FIXED', 'PCT_OF_BASIC']) calc?: string;
  @IsOptional() @IsInt() @Min(0) valueMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) percent?: number;
}

export class CreatePayrollRunDto {
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
  /** Standard working days the month is pro-rated against (default 26). */
  @IsOptional() @IsInt() @Min(1) @Max(31) workingDays?: number;
}

// ── Attendance ──────────────────────────────────────────────────────────────────
export class LogAttendanceDto {
  @IsUUID() employeeId!: string;
  @IsISO8601() date!: string;
  @IsIn(['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY']) status!: string;
  @IsOptional() @IsISO8601() checkIn?: string;
  @IsOptional() @IsISO8601() checkOut?: string;
  @IsOptional() @IsBoolean() late?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class BulkAttendanceEntryDto {
  @IsUUID() employeeId!: string;
  @IsIn(['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY']) status!: string;
  @IsOptional() @IsBoolean() late?: boolean;
  @IsOptional() @IsISO8601() checkIn?: string;
  @IsOptional() @IsISO8601() checkOut?: string;
}

export class BulkAttendanceDto {
  @IsISO8601() date!: string;
  @ValidateNested({ each: true }) @Type(() => BulkAttendanceEntryDto) entries!: BulkAttendanceEntryDto[];
}

export class AttendanceQueryDto {
  @IsInt() @Min(2000) @Max(2100) @Type(() => Number) year!: number;
  @IsInt() @Min(1) @Max(12) @Type(() => Number) month!: number;
}

// ── Policy module + custom fields ─────────────────────────────────────────────────
export class CreateCustomFieldDto {
  @IsString() @MinLength(1) label!: string;
  @IsString() @MinLength(1) fieldKey!: string;
  @IsIn(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT']) fieldType!: string;
  @IsOptional() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class PolicyFieldValueDto {
  @IsUUID() fieldId!: string;
  @IsOptional() @IsString() value?: string;
}

export class CreatePolicyDto {
  @IsString() @MinLength(1) name!: string;
  @IsIn(['LEAVE', 'ATTENDANCE', 'CONDUCT', 'BENEFITS', 'PAYROLL', 'OTHER']) category!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsISO8601() effectiveDate?: string;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => PolicyFieldValueDto) fields?: PolicyFieldValueDto[];
}

export class UpdatePolicyStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED']) status!: string;
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

// ── Payroll → GL posting ────────────────────────────────────────────────────────────
/** Maps the GL accounts an approved payroll run posts to. Each is optional; expense + payable are the
 * minimum to post. Pass an empty string / omit to clear an account. */
export class SetPayrollGlDto {
  @IsOptional() @IsUUID() salaryExpenseAccountId?: string;
  @IsOptional() @IsUUID() salaryPayableAccountId?: string;
  @IsOptional() @IsUUID() deductionsPayableAccountId?: string;
}

/** Set or clear a department's per-department salary-expense account override (null = clear → fall
 * back to the tenant-level default). `@IsOptional` permits an explicit `null` to clear it. */
export class SetDepartmentSalaryAccountDto {
  @IsOptional() @IsUUID() salaryExpenseAccountId?: string | null;
}
