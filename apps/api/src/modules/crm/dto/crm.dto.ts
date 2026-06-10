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
  Min,
  MinLength,
} from 'class-validator';
import { DEAL_STAGES } from '../crm.util';

export class CreateClientDto {
  @IsString() @MinLength(1) companyName!: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsIn(['PROSPECT', 'ACTIVE', 'INACTIVE']) status?: string;
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
}

export class UpdateDealStageDto {
  @IsIn(DEAL_STAGES as readonly string[]) stage!: string;
}
