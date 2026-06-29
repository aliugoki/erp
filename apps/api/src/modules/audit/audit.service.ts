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

export interface AuditQuery {
  from?: string;
  to?: string;
  action?: string;
  resource?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}

type Row = Record<string, unknown>;

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

  /** Paginated, filtered audit trail for the current tenant (RLS-scoped) — powers the audit viewer.
   * Resolves the actor's email via a same-tenant LEFT JOIN. All filter values are bound as params. */
  async listForTenant(q: AuditQuery) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 25));
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.from) where.push(`a.created_at::date >= $${params.push(q.from)}::date`);
    if (q.to) where.push(`a.created_at::date <= $${params.push(q.to)}::date`);
    if (q.action) where.push(`a.action ILIKE $${params.push(`%${q.action}%`)}`);
    if (q.resource) where.push(`a.resource ILIKE $${params.push(`%${q.resource}%`)}`);
    if (q.userId) where.push(`a.user_id = $${params.push(q.userId)}`);
    const clause = where.join(' AND ');

    return this.tenantTx.run(async (m) => {
      const total = Number(
        ((await m.query(`SELECT count(*) AS c FROM audit_log a WHERE ${clause}`, params)) as Array<{ c: string }>)[0]!.c,
      );
      const rows = (await m.query(
        `SELECT a.id, a.user_id, u.email AS user_email, a.action, a.resource, a.resource_id,
                a.old_value, a.new_value, a.ip_address, a.trace_id, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE ${clause} ORDER BY a.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params,
      )) as Row[];
      return {
        data: rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          userEmail: r.user_email ?? null,
          action: r.action,
          resource: r.resource,
          resourceId: r.resource_id ?? null,
          oldValue: r.old_value ?? null,
          newValue: r.new_value ?? null,
          ipAddress: r.ip_address ?? null,
          traceId: r.trace_id ?? null,
          createdAt: r.created_at,
        })),
        meta: { pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } },
      };
    });
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
