import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Create a company branch (physical site / office). Only `name` is required. */
export class CreateBranchDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  /** Branch manager — an existing employee. */
  @IsOptional() @IsUUID() managerId?: string;
  /** Finance cost center this branch maps to (enables branch P&L). */
  @IsOptional() @IsUUID() costCenterId?: string;
  @IsOptional() @IsBoolean() isHeadOffice?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Update a branch. Every field optional; omitted fields are left unchanged (null clears manager/cost
 * center via the explicit handling in the service). */
export class UpdateBranchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsUUID() managerId?: string | null;
  @IsOptional() @IsUUID() costCenterId?: string | null;
  @IsOptional() @IsBoolean() isHeadOffice?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
