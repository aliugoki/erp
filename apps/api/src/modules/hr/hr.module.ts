import { Module } from '@nestjs/common';
import { HrEnterpriseController } from './hr-enterprise.controller';
import { HrEnterpriseService } from './hr-enterprise.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

@Module({
  controllers: [HrController, HrEnterpriseController],
  providers: [HrService, HrEnterpriseService],
})
export class HrModule {}
