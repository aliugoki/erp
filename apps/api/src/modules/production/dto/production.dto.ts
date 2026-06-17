import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';

// ── Work centers ────────────────────────────────────────────────────────────
export class CreateWorkCenterDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(0) costPerHourMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() notes?: string;
}
export class UpdateWorkCenterDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(0) costPerHourMinor?: number;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
  @IsOptional() @IsString() notes?: string;
}

// ── BOM ───────────────────────────────────────────────────────────────────────
export class BomLineDto {
  @IsUUID() componentProductId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) scrapPct?: number;
  @IsOptional() @IsString() notes?: string;
}
export class BomOperationDto {
  @IsOptional() @IsUUID() workCenterId?: string;
  @IsOptional() @IsInt() @Min(1) sequence?: number;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsInt() @Min(0) runMinutes?: number;
  @IsOptional() @IsString() notes?: string;
}
export class CreateBomDto {
  @IsUUID() productId!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsInt() @Min(1) outputQty?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) overheadPct?: number;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => BomLineDto) lines!: BomLineDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BomOperationDto) operations?: BomOperationDto[];
}
export class UpdateBomDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() @Min(1) outputQty?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) overheadPct?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BomLineDto) lines?: BomLineDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BomOperationDto) operations?: BomOperationDto[];
}
export class BomStatusDto {
  @IsIn(['ACTIVE', 'ARCHIVED', 'DRAFT']) status!: string;
}

// ── Custom attributes (EAV) ────────────────────────────────────────────────────
export class CreateAttributeDto {
  @IsString() @MinLength(1) attrKey!: string;
  @IsString() @MinLength(1) label!: string;
  @IsOptional() @IsIn(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT']) dataType?: string;
  @IsOptional() @IsString() options?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() sort?: number;
}
export class AttributeValueDto {
  @IsUUID() attributeId!: string;
  @IsOptional() @IsString() value?: string;
}

// ── Production orders ───────────────────────────────────────────────────────────
export class OrderMaterialDto {
  @IsUUID() componentProductId!: string;
  @IsInt() @Min(1) requiredQty!: number;
}
export class CreateOrderDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() bomId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsInt() @Min(1) plannedQty!: number;
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) overheadPct?: number;
  @IsOptional() @IsISO8601() plannedStart?: string;
  @IsOptional() @IsISO8601() plannedEnd?: string;
  @IsOptional() @IsString() notes?: string;
  /** Ad-hoc materials when no BOM is given (ignored if bomId is set). */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OrderMaterialDto) materials?: OrderMaterialDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttributeValueDto) attributes?: AttributeValueDto[];
}
export class UpdateOrderDto {
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) overheadPct?: number;
  @IsOptional() @IsISO8601() plannedStart?: string;
  @IsOptional() @IsISO8601() plannedEnd?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttributeValueDto) attributes?: AttributeValueDto[];
}
export class IssueMaterialDto {
  @IsUUID() materialId!: string;
  @IsInt() @Min(1) quantity!: number;
}
export class IssueMaterialsDto {
  /** Omit to issue every line's remaining required quantity. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => IssueMaterialDto) materials?: IssueMaterialDto[];
}
export class OperationActualDto {
  @IsUUID() operationId!: string;
  @IsInt() @Min(0) actualMinutes!: number;
}
export class CompleteOrderDto {
  /** Defaults to the planned quantity. */
  @IsOptional() @IsInt() @Min(1) producedQty?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OperationActualDto) operations?: OperationActualDto[];
}
