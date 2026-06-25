import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { RequestContext } from '../../common/request-context/request-context';

export interface AuditEntry {
  action: string;
  resource: string;
  resourceId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Writes audit rows within the current tenant's RLS context. Actor (userId), tenantId, ip and
 * traceId are taken from RequestContext, so callers only describe the change. Audit failures are
 * logged but never break the underlying request.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly tenantTx: TenantTransactionService) {}

  /** Record an audit row in its own tenant-scoped transaction (used by the auto-audit interceptor). */
  async record(entry: AuditEntry): Promise<void> {
    const tenantId = RequestContext.tenantId();
    if (!tenantId) return; // nothing to scope the audit row to (e.g. unauthenticated)
    try {
      await this.tenantTx.runFor(tenantId, (manager) => this.insert(manager, tenantId, entry));
    } catch (err) {
      this.logger.error(`Failed to write audit row: ${(err as Error).message}`);
    }
  }

  /** Record an audit row using an existing transaction's manager, so it commits atomically with the
   * mutation that produced it (the tenant GUC must already be set on that transaction). Pass
   * `tenantOverride` when acting on another tenant's data (e.g. a SUPER_ADMIN cross-tenant change) so
   * the audit row is scoped to THAT tenant and satisfies its RLS WITH CHECK — the actor (userId) is
   * still taken from RequestContext. */
  async recordWith(manager: EntityManager, entry: AuditEntry, tenantOverride?: string): Promise<void> {
    const tenantId = tenantOverride ?? RequestContext.tenantId();
    if (!tenantId) return;
    await this.insert(manager, tenantId, entry);
  }

  private insert(manager: EntityManager, tenantId: string, entry: AuditEntry): Promise<unknown> {
    return manager.query(
      `INSERT INTO audit_log
         (tenant_id, user_id, action, resource, resource_id, old_value, new_value, ip_address, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        RequestContext.userId() ?? null,
        entry.action,
        entry.resource,
        entry.resourceId ?? null,
        entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
        entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
        RequestContext.ip() ?? null,
        RequestContext.requestId() ?? null,
      ],
    );
  }
}
