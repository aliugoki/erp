import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SalesLineDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsString() @MinLength(1) description!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsInt() @Min(0) unitPriceMinor!: number;
}

export class CreateQuotationDto {
  @IsUUID() clientId!: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SalesLineDto) lines!: SalesLineDto[];
}

export class UpdateQuotationStatusDto {
  @IsIn(['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']) status!: string;
}

export class CreateOrderDto {
  @IsUUID() clientId!: string;
  @IsOptional() @IsISO8601() expectedDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SalesLineDto) lines!: SalesLineDto[];
}
