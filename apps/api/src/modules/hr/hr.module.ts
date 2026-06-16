import { Module } from '@nestjs/common';
import { HrEnterpriseController } from './hr-enterprise.controller';
import { HrEnterpriseService } from './hr-enterprise.service';
import { HrPolicyController } from './hr-policy.controller';
import { HrPolicyService } from './hr-policy.service';
import { HrProfileController } from './hr-profile.controller';
import { HrProfileService } from './hr-profile.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

@Module({
  controllers: [HrController, HrEnterpriseController, HrProfileController, HrPolicyController],
  providers: [HrService, HrEnterpriseService, HrProfileService, HrPolicyService],
})
export class HrModule {}
