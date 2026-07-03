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
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** One expense line. `expenseAccountId` is the GL account this line debits when the claim is paid to
 * the ledger — required only for GL posting; a sub-ledger-only claim can omit it. */
export class ExpenseLineDto {
  @IsString() @MinLength(1) @MaxLength(200) description!: string;
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsUUID() expenseAccountId?: string;
}

export class CreateExpenseClaimDto {
  @IsUUID() employeeId!: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsISO8601() claimDate?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() costCenterId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ExpenseLineDto) lines!: ExpenseLineDto[];
}

/** Edit a DRAFT claim. Every field optional; `lines` (when given) replaces the set. */
export class UpdateExpenseClaimDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsISO8601() claimDate?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() costCenterId?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ExpenseLineDto) lines?: ExpenseLineDto[];
}

export class DecideClaimDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Pay/reimburse an approved claim. Provide `paymentAccountId` (a cash/bank account) to also post the
 * reimbursement to the GL; omit it to mark the claim paid in the sub-ledger only. */
export class PayClaimDto {
  @IsOptional() @IsUUID() paymentAccountId?: string;
  @IsOptional() @IsISO8601() paidOn?: string;
}
