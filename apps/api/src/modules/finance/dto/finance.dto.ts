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
  /** Tag a detail account as a CASH or BANK control account (drives voucher rules + cash/bank books). */
  @IsOptional() @IsIn(['NONE', 'CASH', 'BANK']) controlType?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountNumber?: string;
}

/** Editable account fields (name + cash/bank tagging). Code/type/parent are structural and fixed. */
export class UpdateAccountDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(['NONE', 'CASH', 'BANK']) controlType?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountNumber?: string;
}

export class CreatePeriodDto {
  @IsString() @MinLength(1) name!: string;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
}

export class UpdatePeriodDto {
  @IsIn(['OPEN', 'CLOSED']) status!: string;
}

/** Cash/Bank book window. */
export class CashBookQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class ListTransactionsQueryDto {
  @IsOptional() @IsIn(['BRV', 'BPV', 'CPV', 'CRV', 'JV']) voucherType?: string;
  @IsOptional() @IsIn(['DRAFT', 'POSTED']) status?: string;
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
  /** Optional analytical dimension (branch / department / project). */
  @IsOptional() @IsUUID() costCenterId?: string;
}

export class CreateCostCenterDto {
  @IsString() @MinLength(1) code!: string;
  @IsString() @MinLength(1) name!: string;
}

export class SetBudgetDto {
  @IsUUID() periodId!: string;
  @IsUUID() accountId!: string;
  @IsInt() @Min(0) amountMinor!: number;
}

export class BudgetQueryDto {
  @IsUUID() periodId!: string;
}

export class YearEndCloseDto {
  @IsUUID() periodId!: string;
  /** Equity account that absorbs net income (retained earnings). */
  @IsUUID() retainedEarningsAccountId!: string;
}

export class CreateTransactionDto {
  @IsString() @MinLength(1) description!: string;
  /** Voucher type — BRV/BPV/CPV/CRV/JV. Defaults to JV (general journal voucher). */
  @IsOptional() @IsIn(['BRV', 'BPV', 'CPV', 'CRV', 'JV']) voucherType?: string;
  @IsOptional() @IsISO8601() occurredOn?: string;
  @IsOptional() @IsString() reference?: string;
  /** Save as a DRAFT (maker) instead of posting immediately. Drafts don't hit the ledger until posted. */
  @IsOptional() @IsBoolean() draft?: boolean;
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryDto)
  entries!: JournalEntryDto[];
}

/** Mark/unmark bank or cash postings as cleared on a statement (bank reconciliation). */
export class ReconcileDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  entryIds!: string[];
  @IsBoolean() reconciled!: boolean;
  @IsOptional() @IsISO8601() reconciledAt?: string;
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

// ── Accounts Payable (vendors / bills / payments) ───────────────────────────

export class CreateVendorDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
}

export class CreateBillDto {
  @IsString() @MinLength(1) number!: string;
  @IsUUID() vendorId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lineItems!: InvoiceLineDto[];
  @IsOptional() @IsInt() @Min(0) taxMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsISO8601() billDate?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
}

export class CreateBillPaymentDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsISO8601() paidOn?: string;
  @IsOptional() @IsString() method?: string;
}

export class ListBillsQueryDto {
  @IsOptional() @IsIn(['DRAFT', 'RECEIVED', 'PARTIALLY_PAID', 'PAID', 'VOID']) status?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

export class ListInvoicesQueryDto {
  @IsOptional() @IsIn(['DRAFT', 'SENT', 'PAID', 'VOID']) status?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
