import { Global, Module } from '@nestjs/common';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

/**
 * Per-tenant business-rule policy engine (ADR-011, proposed). Global so any module can inject
 * PolicyService to enforce policies at its decision points (Phase B).
 */
@Global()
@Module({
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
