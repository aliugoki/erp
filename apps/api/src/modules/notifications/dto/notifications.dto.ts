import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SetPreferenceDto {
  @IsBoolean() inApp!: boolean;
  @IsBoolean() email!: boolean;
}

export class FeedQueryDto {
  @IsOptional() @IsIn(['unread', 'all', 'archived']) filter?: 'unread' | 'all' | 'archived';
  @IsOptional() @IsIn(['crm', 'inventory', 'finance', 'hr', 'production', 'ecommerce', 'system']) category?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
