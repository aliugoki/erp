import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const CHANNELS = ['EMAIL', 'WEB', 'PHONE', 'CHAT'] as const;
const STATUSES = ['NEW', 'OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED'] as const;

// ── Agent: tickets ──────────────────────────────────────────────────────────────
export class CreateTicketDto {
  @IsString() @MinLength(1) subject!: string;
  @IsString() @MinLength(1) body!: string; // the first message
  @IsString() @MinLength(1) requesterName!: string;
  @IsEmail() requesterEmail!: string;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: string;
  @IsOptional() @IsIn(CHANNELS as unknown as string[]) channel?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsUUID() teamId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

export class UpdateTicketDto {
  @IsOptional() @IsString() @MinLength(1) subject?: string;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

export class ReplyDto {
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsBoolean() isInternal?: boolean; // an internal note isn't sent to the customer
}

export class AssignTicketDto {
  @IsOptional() @IsUUID() assignedTo?: string | null;
  @IsOptional() @IsUUID() teamId?: string | null;
}

export class SetStatusDto {
  @IsIn(STATUSES as unknown as string[]) status!: string;
}

export class CsatDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() comment?: string;
}

// ── Settings ────────────────────────────────────────────────────────────────────
export class UpsertTeamDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) memberIds?: string[];
}

export class UpsertSlaPolicyDto {
  @IsIn(PRIORITIES as unknown as string[]) priority!: string;
  @IsInt() @Min(1) firstResponseMins!: number;
  @IsInt() @Min(1) resolutionMins!: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpsertCannedResponseDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() @MinLength(1) body!: string;
}

// ── Customer portal ─────────────────────────────────────────────────────────────
export class PortalCreateTicketDto {
  @IsString() @MinLength(1) subject!: string;
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH'] as unknown as string[]) priority?: string;
  @IsOptional() @IsString() orderNo?: string;
}

export class PortalReplyDto {
  @IsString() @MinLength(1) body!: string;
}
