import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { TenantContext } from './tenant-context';

/** Per-transaction Postgres safety limits (Phase 7.1), in milliseconds. */
export interface TxTimeouts {
  statementMs: number;
  lockMs: number;
  idleTxMs: number;
}

const DEFAULT_TIMEOUTS: TxTimeouts = { statementMs: 10_000, lockMs: 5_000, idleTxMs: 15_000 };

/**
 * Runs DB work inside a transaction with the per-transaction `app.tenant_id` GUC set, which is what
 * RLS reads (ADR-002). `set_config(..., true)` is TRANSACTION-LOCAL — mandatory under PgBouncer
 * transaction pooling, where a session-level `SET` would leak across pooled clients.
 *
 * Phase 7.1: the same transaction also applies `SET LOCAL statement_timeout / lock_timeout /
 * idle_in_transaction_session_timeout`, so NO tenant-scoped query, lock wait, or abandoned
 * transaction can hang a pooled connection unboundedly. `SET LOCAL` is transaction-scoped, so it's
 * also PgBouncer-pool-safe.
 *
 * Every tenant-scoped DB operation in the running app goes through here. The `EntityManager` handed to
 * `work` is the one bound to that transaction.
 */
@Injectable()
export class TenantTransactionService {
  private readonly timeouts: TxTimeouts;

  constructor(
    private readonly dataSource: DataSource,
    timeouts?: Partial<TxTimeouts>,
  ) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  }

  /** Run `work` for the current request's tenant. Throws if no tenant is in context. */
  run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.runFor(TenantContext.require(), work);
  }

  /** Run `work` with an explicit tenant id (e.g. background jobs that carry their own tenant). */
  runFor<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      // Bound every query/lock/idle-txn in this transaction (values are validated ints, not user input).
      await manager.query(`SET LOCAL statement_timeout = ${this.timeouts.statementMs}`);
      await manager.query(`SET LOCAL lock_timeout = ${this.timeouts.lockMs}`);
      await manager.query(`SET LOCAL idle_in_transaction_session_timeout = ${this.timeouts.idleTxMs}`);
      return work(manager);
    });
  }
}
