import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, MinLength } from 'class-validator';

export class CreateWarehouseDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() location?: string;
}

export class CreateProductDto {
  @IsString() @MinLength(1) sku!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsInt() @Min(0) costPriceMinor?: number;
  @IsOptional() @IsInt() @Min(0) sellPriceMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsInt() @Min(0) minStock?: number;
}

export class CreateMovementDto {
  @IsUUID() productId!: string;
  @IsIn(['IN', 'OUT', 'TRANSFER']) type!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() toWarehouseId?: string;
  @IsOptional() @IsString() reference?: string;
}
