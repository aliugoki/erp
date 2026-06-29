import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

const FORMATS = ['pdf', 'xlsx', 'csv'] as const;
const FREQS = ['daily', 'weekly', 'monthly'] as const;

export class CreateReportScheduleDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() presetKey?: string;
  @IsOptional() @IsUUID() reportId?: string;
  @IsIn(FORMATS) format!: (typeof FORMATS)[number];
  @IsArray() @ArrayMinSize(1) @IsEmail({}, { each: true }) recipients!: string[];
  @IsIn(FREQS) frequency!: (typeof FREQS)[number];
  @IsInt() @Min(0) @Max(23) hour!: number;
  @IsInt() @Min(0) @Max(59) minute!: number;
  @IsOptional() @IsInt() @Min(0) @Max(6) dayOfWeek?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateReportScheduleDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() presetKey?: string | null;
  @IsOptional() @IsUUID() reportId?: string | null;
  @IsOptional() @IsIn(FORMATS) format?: (typeof FORMATS)[number];
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsEmail({}, { each: true }) recipients?: string[];
  @IsOptional() @IsIn(FREQS) frequency?: (typeof FREQS)[number];
  @IsOptional() @IsInt() @Min(0) @Max(23) hour?: number;
  @IsOptional() @IsInt() @Min(0) @Max(59) minute?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6) dayOfWeek?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(28) dayOfMonth?: number | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
