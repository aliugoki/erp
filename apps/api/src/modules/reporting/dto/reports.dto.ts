import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Optional inclusive month range for the profit & loss report (ISO dates, e.g. 2026-01-01). */
export class ProfitLossQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class ReportFilterDto {
  @IsString() column!: string;
  @IsString() value!: string;
}

/** Ad-hoc report config. Column/filter/group identifiers are validated against the dataset whitelist
 * by the query compiler, so only known columns can ever be referenced. */
export class RunReportDto {
  @IsString() @MinLength(1) source!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) columns?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReportFilterDto) filters?: ReportFilterDto[];
  @IsOptional() @IsString() groupBy?: string;
}

export class CreateReportDto extends RunReportDto {
  @IsString() @MinLength(1) name!: string;
}
