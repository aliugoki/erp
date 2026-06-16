import { Module } from '@nestjs/common';
import { CrmEnterpriseController } from './crm-enterprise.controller';
import { CrmEnterpriseService } from './crm-enterprise.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  controllers: [CrmController, CrmEnterpriseController],
  providers: [CrmService, CrmEnterpriseService],
})
export class CrmModule {}
