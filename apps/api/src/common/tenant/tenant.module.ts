import { Global, Module } from '@nestjs/common';
import { TenantTransactionService } from './tenant-transaction.service';

/**
 * Provides the tenancy mechanism (the `set_config` transaction runner) app-wide. The per-request
 * wiring that reads tenantId from the JWT and pushes it into RequestContext lands in Phase 2.3;
 * here we expose the primitive every tenant-scoped DB operation builds on.
 */
@Global()
@Module({
  providers: [TenantTransactionService],
  exports: [TenantTransactionService],
})
export class TenantModule {}
