import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE', 'WALLET', 'BANK', 'CREDIT', 'VOUCHER'] as const;

// ── Registers ─────────────────────────────────────────────────────────────────
export class CreateRegisterDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

export class UpdateRegisterDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}

// ── Shifts ────────────────────────────────────────────────────────────────────
export class OpenShiftDto {
  @IsUUID() registerId!: string;
  @IsOptional() @IsInt() @Min(0) openingFloatMinor?: number;
  @IsOptional() @IsString() notes?: string;
}

export class CloseShiftDto {
  @IsInt() @Min(0) countedCashMinor!: number;
  @IsOptional() @IsString() notes?: string;
}

// ── Sales ─────────────────────────────────────────────────────────────────────
export class PosLineDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsString() @MinLength(1) description!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsInt() @Min(0) unitPriceMinor!: number;
  @IsOptional() @IsInt() @Min(0) discountMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) taxRate?: number;
}

export class PosPaymentDto {
  @IsIn(PAYMENT_METHODS as unknown as string[]) method!: string;
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsString() reference?: string;
}

export class CreateSaleDto {
  @IsUUID() registerId!: string;
  @IsUUID() shiftId!: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsInt() @Min(0) orderDiscountMinor?: number;
  @IsOptional() @IsString() notes?: string;
  /** When true the sale is held (PARKED): no stock movement, no payment required. */
  @IsOptional() park?: boolean;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PosLineDto) lines!: PosLineDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PosPaymentDto) payments?: PosPaymentDto[];
}

/** Finalize a PARKED sale by settling it with tenders (decrements stock, completes the sale). */
export class CompleteSaleDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PosPaymentDto) payments!: PosPaymentDto[];
}

export class RefundLineDto {
  @IsUUID() lineId!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class RefundSaleDto {
  /** Specific lines/quantities to return; omit to refund the whole remaining sale. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RefundLineDto) lines?: RefundLineDto[];
  @IsOptional() @IsIn(PAYMENT_METHODS as unknown as string[]) method?: string;
  @IsOptional() @IsString() reason?: string;
}
