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
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateAccountDto {
  @IsString() @MinLength(1) code!: string;
  @IsString() @MinLength(1) name!: string;
  /** Required for a root (level-1) account; inherited from the parent otherwise. */
  @IsOptional() @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) type?: string;
  /** Parent (must be a group account) for the multi-level chart of accounts. Root account if omitted.
   *  The tree is capped at 4 levels (Main head → Control → Subsidiary → Detail). */
  @IsOptional() @IsUUID() parentId?: string;
  /** Group (header) accounts organise the tree and cannot be posted to; leaves are postable. */
  @IsOptional() @IsBoolean() isGroup?: boolean;
}

export class ListTransactionsQueryDto {
  @IsOptional() @IsIn(['BRV', 'BPV', 'CPV', 'CRV', 'JV']) voucherType?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

/** General-ledger query: postings for one account over an optional date window. */
export class LedgerQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

/** Point-in-time reports (trial balance, balance sheet): balances as of a date (default: today). */
export class AsOfQueryDto {
  @IsOptional() @IsISO8601() asOf?: string;
}

/** Period report (income statement): activity within a date window. */
export class PeriodQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class JournalEntryDto {
  @IsUUID() accountId!: string;
  @IsOptional() @IsInt() @Min(0) debitMinor?: number;
  @IsOptional() @IsInt() @Min(0) creditMinor?: number;
}

export class CreateTransactionDto {
  @IsString() @MinLength(1) description!: string;
  /** Voucher type — BRV/BPV/CPV/CRV/JV. Defaults to JV (general journal voucher). */
  @IsOptional() @IsIn(['BRV', 'BPV', 'CPV', 'CRV', 'JV']) voucherType?: string;
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
