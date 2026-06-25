import { Global, Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

/**
 * Per-tenant composite RBAC (ADR-006). Global so AuthService (token-time role expansion) and the
 * users module (assignment validation) can inject RbacService without import wiring.
 */
@Global()
@Module({
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
