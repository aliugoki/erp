import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, MinLength } from 'class-validator';

export class CreateWarehouseDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsUUID() branchId?: string;
}

export class UpdateWarehouseDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsUUID() branchId?: string;
}

/** Edit a product's master data — every field optional. SKU is immutable (it keys the ledger). */
export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  /** Scannable code on the packaging. Pass an empty string to clear it. */
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsInt() @Min(0) costPriceMinor?: number;
  @IsOptional() @IsInt() @Min(0) sellPriceMinor?: number;
  @IsOptional() @IsInt() @Min(0) minStock?: number;
}

export class CreateProductDto {
  @IsString() @MinLength(1) sku!: string;
  /** Scannable code printed on the packaging; omit and mint one later with POST products/:id/barcode. */
  @IsOptional() @IsString() barcode?: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsInt() @Min(0) costPriceMinor?: number;
  @IsOptional() @IsInt() @Min(0) sellPriceMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsInt() @Min(0) minStock?: number;
}

/** A node in the 3-level product category tree. Omit `parentId` for a top-level category; the server
 * derives the level from the parent (and rejects nesting beyond three levels). */
export class CreateCategoryDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsUUID() parentId?: string;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() code?: string;
}

/** Re-classify a product into a category (or clear it with a null `categoryId`). */
export class SetProductCategoryDto {
  @IsOptional() @IsUUID() categoryId?: string | null;
}

export class CreateMovementDto {
  @IsUUID() productId!: string;
  @IsIn(['IN', 'OUT', 'TRANSFER']) type!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() toWarehouseId?: string;
  @IsOptional() @IsString() reference?: string;
}

/** Mint or record a product's barcode. */
export class GenerateProductBarcodeDto {
  /** A real supplier EAN to record; omit to mint an internal one. */
  @IsOptional() @IsString() value?: string;
  /** GS1 in-store prefix (20–29) for minted codes. */
  @IsOptional() @IsString() prefix?: string;
  /** Replace an existing barcode (invalidates labels already printed). */
  @IsOptional() @IsBoolean() regenerate?: boolean;
}
