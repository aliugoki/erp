import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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
