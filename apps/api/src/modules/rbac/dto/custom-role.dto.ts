import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CustomRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  /** Built-in capability roles this custom role bundles (optional if `permissions` are given). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberRoles?: string[];

  /** Fine-grained catalog permissions this custom role grants directly (Path 2). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  // Validated server-side: a role must grant at least one capability or permission.
}
