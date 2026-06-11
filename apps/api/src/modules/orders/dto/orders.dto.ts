import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class CreateOrderDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsInt() @Min(0) unitPriceMinor!: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  /** Test/chaos hook: force a failure at a given saga step to exercise compensations. */
  @IsOptional() @IsIn(['reserve', 'invoice', 'pay']) failAt?: 'reserve' | 'invoice' | 'pay';
}
