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
  Length,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateAccountDto {
  @IsString() @MinLength(1) code!: string;
  @IsString() @MinLength(1) name!: string;
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) type!: string;
}

export class JournalEntryDto {
  @IsUUID() accountId!: string;
  @IsOptional() @IsInt() @Min(0) debitMinor?: number;
  @IsOptional() @IsInt() @Min(0) creditMinor?: number;
}

export class CreateTransactionDto {
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsISO8601() occurredOn?: string;
  @IsOptional() @IsString() reference?: string;
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryDto)
  entries!: JournalEntryDto[];
}

export class InvoiceLineDto {
  @IsString() @MinLength(1) description!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsInt() @Min(0) unitPriceMinor!: number;
}

export class CreateInvoiceDto {
  @IsString() @MinLength(1) number!: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lineItems!: InvoiceLineDto[];
  @IsOptional() @IsInt() @Min(0) taxMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
}

export class ListInvoicesQueryDto {
  @IsOptional() @IsIn(['DRAFT', 'SENT', 'PAID', 'VOID']) status?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
