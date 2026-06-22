import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const PHARMACY_MODES = ['RETAIL', 'HOSPITAL', 'WHOLESALE'] as const;
export const DRUG_SCHEDULES = ['OTC', 'RX', 'SCHEDULE_G', 'NARCOTIC', 'PSYCHOTROPIC'] as const;
export const DRUG_FORMS = ['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'DROPS', 'INHALER', 'SACHET', 'OTHER'] as const;

export class SetPharmacyConfigDto {
  @IsOptional() @IsIn(PHARMACY_MODES) mode?: (typeof PHARMACY_MODES)[number];
  @IsOptional() @IsBoolean() controlledRegisterEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) nearExpiryDays?: number;
  @IsOptional() @IsBoolean() allowDispenseWithoutStock?: boolean;
  @IsOptional() @IsUUID() defaultWarehouseId?: string;
  @IsOptional() @IsInt() @Min(0) defaultTaxBp?: number;
  @IsOptional() @IsString() currency?: string;
}

export class CreateDrugDto {
  /** Link to an existing inventory product, or provide newProduct to create one. */
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MinLength(1) sku?: string;
  @IsOptional() @IsString() @MinLength(1) name?: string;

  @IsOptional() @IsString() genericName?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() strength?: string;
  @IsOptional() @IsIn(DRUG_FORMS) form?: (typeof DRUG_FORMS)[number];
  @IsOptional() @IsInt() @Min(1) packSize?: number;
  @IsOptional() @IsIn(DRUG_SCHEDULES) schedule?: (typeof DRUG_SCHEDULES)[number];
  @IsOptional() @IsBoolean() rxRequired?: boolean;
  @IsOptional() @IsBoolean() controlled?: boolean;
  @IsOptional() @IsString() therapeuticCategory?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsInt() @Min(0) maxLevel?: number;
  @IsOptional() @IsString() storage?: string;
}

export class UpdateDrugDto {
  @IsOptional() @IsString() genericName?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() strength?: string;
  @IsOptional() @IsIn(DRUG_FORMS) form?: (typeof DRUG_FORMS)[number];
  @IsOptional() @IsInt() @Min(1) packSize?: number;
  @IsOptional() @IsIn(DRUG_SCHEDULES) schedule?: (typeof DRUG_SCHEDULES)[number];
  @IsOptional() @IsBoolean() rxRequired?: boolean;
  @IsOptional() @IsBoolean() controlled?: boolean;
  @IsOptional() @IsString() therapeuticCategory?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsInt() @Min(0) maxLevel?: number;
  @IsOptional() @IsString() storage?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

export class ListDrugsQueryDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsIn(DRUG_SCHEDULES) schedule?: (typeof DRUG_SCHEDULES)[number];
  @IsOptional() @IsIn(['true', 'false']) controlled?: 'true' | 'false';
}

export class ReceiveBatchItemDto {
  @IsUUID() productId!: string;
  @IsString() @MinLength(1) lotNo!: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsInt() @Min(1) qty!: number;
  @IsOptional() @IsInt() @Min(0) unitCostMinor?: number;
}

export class ReceiveBatchDto {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() grnId?: string;
  @IsOptional() @IsDateString() receivedOn?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReceiveBatchItemDto)
  items!: ReceiveBatchItemDto[];
}

export class ExpiryQueryDto {
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) days?: number;
}

export const DISPENSE_TYPES = ['RETAIL_SALE', 'RX', 'HOSPITAL_ISSUE', 'WHOLESALE'] as const;
export const PAYMENT_METHODS = ['CASH', 'CARD', 'CREDIT', 'INSURANCE'] as const;

export class DispenseItemDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) qty!: number;
  /** Override the drug's list price (minor units). Defaults to the product sell price. */
  @IsOptional() @IsInt() @Min(0) unitPriceMinor?: number;
  @IsOptional() @IsInt() @Min(0) discountMinor?: number;
  /** Per-line tax in basis points (e.g. 500 = 5%). Defaults to the pharmacy config tax. */
  @IsOptional() @IsInt() @Min(0) taxBp?: number;
}

export class DispenseDto {
  @IsOptional() @IsIn(DISPENSE_TYPES) type?: (typeof DISPENSE_TYPES)[number];
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() patientRef?: string;
  @IsOptional() @IsString() prescriber?: string;
  @IsOptional() @IsString() prescriptionRef?: string;
  @IsOptional() @IsString() ward?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsString() insurer?: string;
  @IsOptional() @IsInt() @Min(0) insuranceCoverMinor?: number;
  @IsOptional() @IsDateString() occurredOn?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DispenseItemDto)
  items!: DispenseItemDto[];
}

export class ReturnDispenseDto {
  @IsOptional() @IsString() reason?: string;
}

export class SetPharmacyGlConfigDto {
  @IsOptional() @IsUUID() inventoryAccountId?: string;
  @IsOptional() @IsUUID() revenueAccountId?: string;
  @IsOptional() @IsUUID() cogsAccountId?: string;
  @IsOptional() @IsUUID() taxAccountId?: string;
  @IsOptional() @IsUUID() discountAccountId?: string;
  @IsOptional() @IsUUID() receivableAccountId?: string;
  @IsOptional() @IsUUID() clearingAccountId?: string;
  @IsOptional() @IsUUID() writeoffAccountId?: string;
}
