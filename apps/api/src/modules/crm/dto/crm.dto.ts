import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ACTIVITY_TYPES, DEAL_STAGES, LEAD_RATINGS, LEAD_STATUSES } from '../crm.util';

export class CreateClientDto {
  @IsString() @MinLength(1) companyName!: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsIn(['PROSPECT', 'ACTIVE', 'INACTIVE']) status?: string;
  // Enterprise account metadata (all optional, additive).
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsInt() @Min(0) annualRevenueMinor?: number;
}

export class CreateContactDto {
  @IsUUID() clientId!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class CreateDealDto {
  @IsUUID() clientId!: string;
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsInt() @Min(0) valueMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsIn(DEAL_STAGES as readonly string[]) stage?: string;
  @IsOptional() @IsISO8601() expectedCloseDate?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) probability?: number;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsUUID() leadId?: string;
}

export class UpdateDealStageDto {
  @IsIn(DEAL_STAGES as readonly string[]) stage!: string;
  /** Optional reason recorded when moving to CLOSED_LOST. */
  @IsOptional() @IsString() lostReason?: string;
}

// ── Leads ─────────────────────────────────────────────────────────────────────
export class CreateLeadDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsIn(LEAD_RATINGS as readonly string[]) rating?: string;
  @IsOptional() @IsInt() @Min(0) estValueMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateLeadStatusDto {
  @IsIn(LEAD_STATUSES.filter((s) => s !== 'CONVERTED') as readonly string[]) status!: string;
}

/** Convert a qualified lead into an account (+ primary contact) and, optionally, an opportunity.
 * Provide `clientId` to attach to an existing account instead of creating a new one. */
export class ConvertLeadDto {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsBoolean() createDeal?: boolean;
  @IsOptional() @IsString() @MinLength(1) dealTitle?: string;
  @IsOptional() @IsInt() @Min(0) dealValueMinor?: number;
}

// ── Activities / tasks ──────────────────────────────────────────────────────────
export class CreateActivityDto {
  @IsIn(ACTIVITY_TYPES as readonly string[]) type!: string;
  @IsString() @MinLength(1) subject!: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsISO8601() dueAt?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() ownerId?: string;
}

export class CompleteActivityDto {
  @IsOptional() @IsString() outcome?: string;
}

/** Query filters for the activity timeline (any subset). */
export class ListActivityQueryDto {
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() contactId?: string;
}
