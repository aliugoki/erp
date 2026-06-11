import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ForecastOptionsDto {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) horizon?: number;
}

export class AnomalyRangeDto {
  @IsOptional() @IsISO8601() dateFrom?: string;
  @IsOptional() @IsISO8601() dateTo?: string;
}
