import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { PlanTemplate } from '../../features/feature-registry';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(8)
  adminPassword!: string;

  /** Feature plan applied at provisioning (default: business). */
  @IsOptional()
  @IsIn(['starter', 'business', 'enterprise'])
  plan?: PlanTemplate;
}
