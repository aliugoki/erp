import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { TenantContext } from './tenant-context';

/**
 * Runs DB work inside a transaction with the per-transaction `app.tenant_id` GUC set, which is what
 * RLS reads (ADR-002). `set_config(..., true)` is TRANSACTION-LOCAL — mandatory under PgBouncer
 * transaction pooling, where a session-level `SET` would leak across pooled clients.
 *
 * Every tenant-scoped DB operation in the running app goes through here (wired per-request in
 * Phase 2.3). The `EntityManager` handed to `work` is the one bound to that transaction.
 */
@Injectable()
export class TenantTransactionService {
  constructor(private readonly dataSource: DataSource) {}

  /** Run `work` for the current request's tenant. Throws if no tenant is in context. */
  run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.runFor(TenantContext.require(), work);
  }

  /** Run `work` with an explicit tenant id (e.g. background jobs that carry their own tenant). */
  runFor<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return work(manager);
    });
  }
}
