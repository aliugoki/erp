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

const TERMINAL_PROVIDERS = ['NONE', 'SIMULATED', 'BRIDGE'] as const;

// ── Registers ─────────────────────────────────────────────────────────────────
export class CreateRegisterDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsIn(TERMINAL_PROVIDERS as unknown as string[]) cardTerminalProvider?: string;
  @IsOptional() @IsString() cardTerminalUrl?: string;
}

export class UpdateRegisterDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
  @IsOptional() @IsIn(TERMINAL_PROVIDERS as unknown as string[]) cardTerminalProvider?: string;
  @IsOptional() @IsString() cardTerminalUrl?: string;
}

/** Store / receipt branding shown on the printed sales receipt. */
export class SetBrandingDto {
  @IsOptional() @IsString() storeName?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() receiptFooter?: string;
}

/** Map the GL accounts a completed POS sale posts to. */
export class SetPosGlConfigDto {
  @IsOptional() @IsUUID() clearingAccountId?: string;
  @IsOptional() @IsUUID() revenueAccountId?: string;
  @IsOptional() @IsUUID() taxAccountId?: string;
  @IsOptional() @IsUUID() cogsAccountId?: string;
  @IsOptional() @IsUUID() inventoryAccountId?: string;
}

/** Initiate a charge on the register's card terminal (returns approval to attach as a CARD tender). */
export class TerminalChargeDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsString() reference?: string;
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
  @IsOptional() @IsString() cardScheme?: string;
  @IsOptional() @IsString() cardLast4?: string;
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
