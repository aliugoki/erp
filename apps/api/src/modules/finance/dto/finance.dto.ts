import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
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
  @IsOptional() @IsIn(['NONE', 'CASH', 'BANK', 'PAYABLE', 'RECEIVABLE']) controlType?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountNumber?: string;
  /** Denomination for an account that holds a foreign-currency balance (e.g. USD). Omitted = base. */
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

/** Editable account fields (name + cash/bank tagging). Code/type/parent are structural and fixed. */
export class UpdateAccountDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(['NONE', 'CASH', 'BANK', 'PAYABLE', 'RECEIVABLE']) controlType?: string;
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
  /** Book this line in a foreign currency: debit/credit are then minor units of THIS currency and are
   *  converted to base (at the voucher date's rate) for the ledger. Omitted = base currency. */
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

/** Period-end revaluation of all foreign-currency balances; the net FX gain/loss posts to one account. */
export class RevalueFxDto {
  @IsUUID() fxAccountId!: string;
  @IsOptional() @IsISO8601() asOf?: string;
}

export class CreateCostCenterDto {
  @IsString() @MinLength(1) code!: string;
  @IsString() @MinLength(1) name!: string;
}

export class CreateCurrencyDto {
  @IsString() @Length(3, 3) code!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() symbol?: string;
  /** Mark this the tenant's base currency (rate 1.0). At most one base allowed. */
  @IsOptional() @IsBoolean() isBase?: boolean;
}

export class SetRateDto {
  @IsString() @Length(3, 3) currencyCode!: string;
  /** How many BASE units one unit of this currency is worth (e.g. 278.5 for USD→PKR). */
  @IsNumber() @IsPositive() rate!: number;
  @IsOptional() @IsISO8601() asOf?: string;
}

export class ConvertQueryDto {
  @Type(() => Number) @IsInt() amountMinor!: number;
  @IsString() @Length(3, 3) from!: string;
  @IsString() @Length(3, 3) to!: string;
  @IsOptional() @IsISO8601() asOf?: string;
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

export class CreateRecurringDto {
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsIn(['BRV', 'BPV', 'CPV', 'CRV', 'JV']) voucherType?: string;
  @IsIn(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']) frequency!: string;
  @IsISO8601() nextRunDate!: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryDto)
  entries!: JournalEntryDto[];
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

export class StatementLineDto {
  @IsISO8601() date!: string;
  /** Signed minor amount: + deposit / − payment (debit-positive effect on the bank). */
  @IsInt() amountMinor!: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() reference?: string;
}

export class ImportStatementDto {
  @IsUUID() accountId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  lines!: StatementLineDto[];
}

export class AutoMatchDto {
  @IsUUID() accountId!: string;
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
  /** The billed customer (AR subsidiary). Its receivable ledger account is used when posting to the GL. */
  @IsOptional() @IsUUID() customerId?: string;
  /** Legacy: a CRM client as the receivable subsidiary (kept for back-compat; prefer customerId). */
  @IsOptional() @IsUUID() clientId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lineItems!: InvoiceLineDto[];
  @IsOptional() @IsInt() @Min(0) taxMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  /** Post the invoice to the GL: Dr the customer/client receivable / Cr this income account. */
  @IsOptional() @IsUUID() incomeAccountId?: string;
}

export class PayInvoiceDto {
  /** Post the receipt to the GL: Dr this cash·bank account / Cr the client's receivable. */
  @IsOptional() @IsUUID() paymentAccountId?: string;
}

// ── Accounts Payable (vendors / bills / payments) ───────────────────────────

export class CreateVendorDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
}

/** A billable customer (AR subsidiary) — gets its own RECEIVABLE ledger sub-account, like a vendor. */
export class CreateCustomerDto {
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
  /** Purchase-order reference (required when the `finance.require_po_for_bill` policy is on). */
  @IsOptional() @IsString() @MinLength(1) poRef?: string;
  /** Post the bill to the GL: Dr this expense account / Cr the vendor's payable account. */
  @IsOptional() @IsUUID() expenseAccountId?: string;
}

export class CreateBillPaymentDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsISO8601() paidOn?: string;
  @IsOptional() @IsString() method?: string;
  /** Post the payment to the GL: Dr the vendor's payable / Cr this cash·bank account. */
  @IsOptional() @IsUUID() paymentAccountId?: string;
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
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
