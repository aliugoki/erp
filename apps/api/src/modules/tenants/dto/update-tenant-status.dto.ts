import { IsIn } from 'class-validator';
import type { TenantStatus } from '../entities/tenant.entity';

export class UpdateTenantStatusDto {
  /** `suspended` blocks all of the company's users from logging in or refreshing a session. */
  @IsIn(['active', 'suspended'])
  status!: TenantStatus;
}
