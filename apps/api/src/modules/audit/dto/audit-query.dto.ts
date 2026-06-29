import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filters for the audit-log viewer. Identifiers are bound as params. Dates must be a real calendar
 * date in YYYY-MM-DD form: `@Matches` enforces the date-only shape, `@IsISO8601` rejects impossible
 * dates (e.g. 2026-13-99) so a bad value is a 400, not a Postgres cast 500. */
export class AuditQueryDto {
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be an ISO date (YYYY-MM-DD)' }) @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'to must be an ISO date (YYYY-MM-DD)' }) @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() resource?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
