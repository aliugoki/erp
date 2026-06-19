import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, MinLength } from 'class-validator';

const INTERVALS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;

// ── Plans ─────────────────────────────────────────────────────────────────────
export class UpsertPlanDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsInt() @Min(0) amountMinor!: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) taxRate?: number;
  @IsIn(INTERVALS as unknown as string[]) billingInterval!: string;
  @IsOptional() @IsInt() @Min(1) intervalCount?: number;
  @IsOptional() @IsInt() @Min(0) trialDays?: number;
  @IsOptional() @IsInt() @Min(0) setupFeeMinor?: number;
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: string;
}

// ── Subscriptions ───────────────────────────────────────────────────────────────
export class CreateSubscriptionDto {
  @IsUUID() planId!: string;
  @IsString() @MinLength(1) customerName!: string;
  @IsEmail() customerEmail!: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsIn(['AUTO', 'MANUAL']) collectionMode?: string;
  @IsOptional() @IsString() startDate?: string;
}

export class ChangeSubscriptionDto {
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
}

export class CancelSubscriptionDto {
  @IsOptional() @IsBoolean() atPeriodEnd?: boolean; // default: cancel immediately
}

export class MarkInvoicePaidDto {
  @IsOptional() @IsString() paymentRef?: string;
}

// ── GL config ─────────────────────────────────────────────────────────────────
export class SetSubGlConfigDto {
  @IsOptional() @IsUUID() clearingAccountId?: string;
  @IsOptional() @IsUUID() revenueAccountId?: string;
  @IsOptional() @IsUUID() taxAccountId?: string;
}
