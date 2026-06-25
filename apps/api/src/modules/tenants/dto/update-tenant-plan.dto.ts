import { IsIn } from 'class-validator';
import type { PlanTemplate } from '../../features/feature-registry';

export class UpdateTenantPlanDto {
  @IsIn(['starter', 'business', 'enterprise'])
  plan!: PlanTemplate;
}
