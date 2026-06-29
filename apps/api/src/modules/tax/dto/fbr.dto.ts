import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** FBR seller registration + credentials. `apiToken` is write-only (never returned); omit to keep it. */
export class SaveFbrConfigDto {
  @IsString() @MaxLength(40) sellerNtn!: string;
  @IsString() @MaxLength(200) sellerName!: string;
  @IsString() @MaxLength(60) posId!: string;
  @IsIn(['sandbox', 'production']) environment!: 'sandbox' | 'production';
  @IsOptional() @IsString() @MaxLength(512) apiToken?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
