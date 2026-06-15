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
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// ── Stock adjustment / opening ────────────────────────────────────────────────
export class AdjustStockDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  /** Signed quantity: positive = receive into stock, negative = remove. Must be non-zero. */
  @IsInt() quantity!: number;
  /** Unit cost for an inbound adjustment (defaults to the current weighted-average cost). */
  @IsOptional() @IsInt() @Min(0) unitCostMinor?: number;
  @IsOptional() @IsIn(['OPENING', 'ADJUST']) docType?: string;
  @IsOptional() @IsString() narration?: string;
}

export class LedgerQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

// ── Line items ────────────────────────────────────────────────────────────────
export class ReqLineDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) qty!: number;
}
export class PoLineDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) qty!: number;
  @IsOptional() @IsInt() @Min(0) unitPriceMinor?: number;
}
export class GrnLineDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) qty!: number;
  @IsOptional() @IsInt() @Min(0) unitCostMinor?: number;
}
export class GatePassLineDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsString() @MinLength(1) description!: string;
  @IsInt() @Min(1) qty!: number;
}

// ── Requisition ───────────────────────────────────────────────────────────────
export class CreateRequisitionDto {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() requestedBy?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsISO8601() neededBy?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReqLineDto)
  items!: ReqLineDto[];
}

// ── Purchase order ────────────────────────────────────────────────────────────
export class CreatePurchaseOrderDto {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() requisitionId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsISO8601() expectedOn?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PoLineDto)
  items!: PoLineDto[];
}

// ── Goods Receipt Note ────────────────────────────────────────────────────────
export class CreateGrnDto {
  /** Receive against this PO. If `items` is omitted, the PO's outstanding quantities are received. */
  @IsOptional() @IsUUID() poId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() gatePassId?: string;
  @IsOptional() @IsISO8601() receivedOn?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => GrnLineDto)
  items?: GrnLineDto[];
}

// ── Gate pass ─────────────────────────────────────────────────────────────────
export class CreateGatePassDto {
  @IsIn(['INWARD', 'OUTWARD']) direction!: string;
  @IsOptional() @IsBoolean() returnable?: boolean;
  @IsOptional() @IsString() party?: string;
  @IsOptional() @IsString() vehicleNo?: string;
  @IsOptional() @IsISO8601() issuedOn?: string;
  @IsOptional() @IsString() remarks?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => GatePassLineDto)
  items!: GatePassLineDto[];
}

// ── Store issuance ────────────────────────────────────────────────────────────
export class CreateIssueDto {
  /** Issue against this requisition. If `items` is omitted, the requisition's outstanding qtys are issued. */
  @IsOptional() @IsUUID() requisitionId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() issuedTo?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsISO8601() issuedOn?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReqLineDto)
  items?: ReqLineDto[];
}

// ── Material Return Note ──────────────────────────────────────────────────────
export class CreateMrnDto {
  /** Return against this issue. If `items` is omitted, the issue's outstanding (un-returned) qtys are taken. */
  @IsOptional() @IsUUID() issueId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() returnedBy?: string;
  @IsOptional() @IsISO8601() returnedOn?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReqLineDto)
  items?: ReqLineDto[];
}
