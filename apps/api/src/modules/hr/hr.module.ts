import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { HrEnterpriseController } from './hr-enterprise.controller';
import { HrEnterpriseService } from './hr-enterprise.service';
import { HrPayrollGlConsumer } from './hr-payroll-gl.consumer';
import { HrPolicyController } from './hr-policy.controller';
import { HrPolicyService } from './hr-policy.service';
import { HrProfileController } from './hr-profile.controller';
import { HrProfileService } from './hr-profile.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

/** HR/HCM. Beyond core CRUD + the HCM workflows, an approved payroll run posts to the general ledger
 * (via HrPayrollGlConsumer → FinanceService) so payroll integrates with the accounts module. */
@Module({
  imports: [FinanceModule],
  controllers: [HrController, HrEnterpriseController, HrProfileController, HrPolicyController],
  providers: [HrService, HrEnterpriseService, HrProfileService, HrPolicyService, HrPayrollGlConsumer],
})
export class HrModule {}
