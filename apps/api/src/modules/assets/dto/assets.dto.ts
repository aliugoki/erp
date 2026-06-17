import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const METHODS = ['STRAIGHT_LINE', 'DECLINING_BALANCE', 'NONE'] as const;

// ── Categories ──────────────────────────────────────────────────────────────
export class CreateCategoryDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsIn(METHODS as unknown as string[]) method?: string;
  @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) salvagePct?: number;
}
export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsIn(METHODS as unknown as string[]) method?: string;
  @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) salvagePct?: number;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}

// ── Assets ────────────────────────────────────────────────────────────────────
export class CreateAssetDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsISO8601() acquisitionDate?: string;
  @IsInt() @Min(0) acquisitionCostMinor!: number;
  @IsOptional() @IsInt() @Min(0) salvageValueMinor?: number;
  @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @IsOptional() @IsIn(METHODS as unknown as string[]) method?: string;
  @IsOptional() @IsISO8601() depreciationStart?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsUUID() custodianEmployeeId?: string;
  @IsOptional() @IsString() serialNo?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() notes?: string;
}
export class UpdateAssetDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsUUID() custodianEmployeeId?: string;
  @IsOptional() @IsString() serialNo?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() notes?: string;
}
export class DisposeAssetDto {
  @IsOptional() @IsISO8601() disposalDate?: string;
  @IsOptional() @IsInt() @Min(0) proceedsMinor?: number;
}

// ── Depreciation ────────────────────────────────────────────────────────────────
export class RunDepreciationDto {
  /** Period end the depreciation belongs to (YYYY-MM-DD). */
  @IsISO8601() period!: string;
  @IsOptional() @IsString() notes?: string;
}

// ── Maintenance ─────────────────────────────────────────────────────────────────
export class CreateMaintenanceDto {
  @IsUUID() assetId!: string;
  @IsOptional() @IsISO8601() maintDate?: string;
  @IsOptional() @IsIn(['REPAIR', 'SERVICE', 'INSPECTION', 'UPGRADE', 'OTHER']) type?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) costMinor?: number;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsISO8601() nextDueDate?: string;
}
