import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ALL_ROLES } from '../../auth/rbac/role.enum';

export class CreateTenantUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /** Roles to assign (defaults to TENANT_ADMIN when omitted). */
  @IsOptional()
  @IsArray()
  @IsIn(ALL_ROLES, { each: true })
  roles?: string[];
}
