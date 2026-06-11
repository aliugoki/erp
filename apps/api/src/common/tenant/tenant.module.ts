import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { AppConfig } from '@metaxperts/config';
import { TenantTransactionService } from './tenant-transaction.service';

/**
 * Provides the tenancy mechanism (the `set_config` transaction runner) app-wide, configured with the
 * per-transaction Postgres safety timeouts (Phase 7.1). The per-request wiring that reads tenantId
 * from the JWT and pushes it into RequestContext lives in the auth guard (Phase 2.3).
 */
@Global()
@Module({
  providers: [
    {
      provide: TenantTransactionService,
      inject: [DataSource, ConfigService],
      useFactory: (dataSource: DataSource, config: ConfigService<AppConfig, true>) =>
        new TenantTransactionService(dataSource, {
          statementMs: config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
          lockMs: config.get('DB_LOCK_TIMEOUT_MS', { infer: true }),
          idleTxMs: config.get('DB_IDLE_TX_TIMEOUT_MS', { infer: true }),
        }),
    },
  ],
  exports: [TenantTransactionService],
})
export class TenantModule {}
