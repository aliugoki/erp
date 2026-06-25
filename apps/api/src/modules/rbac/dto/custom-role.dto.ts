import { ArrayNotEmpty, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CustomRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  /** Built-in capability roles this custom role bundles. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  memberRoles!: string[];
}
