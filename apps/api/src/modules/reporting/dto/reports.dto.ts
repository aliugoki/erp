import { IsISO8601, IsOptional } from 'class-validator';

/** Optional inclusive month range for the profit & loss report (ISO dates, e.g. 2026-01-01). */
export class ProfitLossQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}
