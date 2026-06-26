import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { RequestContext } from '../../common/request-context/request-context';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { AuditService } from '../audit/audit.service';
import { POLICY_BY_KEY, POLICY_CATALOG, type PolicyDef, coercePolicyValue } from './policy-catalog';

const CACHE_TTL_SECONDS = 60;

type PolicyValue = boolean | number | string;

export interface PolicyView extends PolicyDef {
  value: PolicyValue; // effective (override ∨ default)
  isOverride: boolean;
}

/**
 * Per-tenant policy engine. Resolves the effective value of a registry policy (tenant override ∨
 * default), cached in Redis (short TTL + explicit invalidation), and lets a TENANT_ADMIN set/reset
 * overrides. Modules consult `get`/`getNumber`/`getBool` at decision points (Phase B).
 */
@Injectable()
export class PolicyService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tenantTx: TenantTransactionService,
    private readonly audit: AuditService,
  ) {}

  private cacheKey(tenantId: string): string {
    return `pol:${tenantId}`;
  }

  /** Map of overridden key → value for a tenant (cached). */
  private async overrides(tenantId: string): Promise<Record<string, PolicyValue>> {
    const cached = await this.redis.get(this.cacheKey(tenantId)).catch(() => null);
    if (cached) return JSON.parse(cached) as Record<string, PolicyValue>;
    const rows = (await this.tenantTx.runFor(tenantId, (m) =>
      m.query('SELECT key, value FROM tenant_policy'),
    )) as Array<{ key: string; value: PolicyValue }>;
    const map: Record<string, PolicyValue> = {};
    for (const r of rows) if (POLICY_BY_KEY[r.key]) map[r.key] = r.value;
    await this.redis.set(this.cacheKey(tenantId), JSON.stringify(map), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
    return map;
  }

  /** Effective value of a policy for a tenant (override ∨ registry default). */
  async get(tenantId: string, key: string): Promise<PolicyValue> {
    const def = POLICY_BY_KEY[key];
    if (!def) throw new BadRequestException(`Unknown policy: ${key}`);
    const ov = await this.overrides(tenantId);
    return key in ov ? ov[key]! : def.default;
  }
  async getNumber(tenantId: string, key: string): Promise<number> {
    return Number(await this.get(tenantId, key));
  }
  async getBool(tenantId: string, key: string): Promise<boolean> {
    return Boolean(await this.get(tenantId, key));
  }

  /** The catalog annotated with this tenant's effective values + whether overridden (drives the UI). */
  async listForTenant(): Promise<PolicyView[]> {
    const rows = (await this.tenantTx.run((m) => m.query('SELECT key, value FROM tenant_policy'))) as Array<{
      key: string;
      value: PolicyValue;
    }>;
    const ov = new Map(rows.filter((r) => POLICY_BY_KEY[r.key]).map((r) => [r.key, r.value]));
    return POLICY_CATALOG.map((def) => ({
      ...def,
      value: ov.has(def.key) ? ov.get(def.key)! : def.default,
      isOverride: ov.has(def.key),
    }));
  }

  /** Set a tenant override (TENANT_ADMIN). Validated + coerced against the registry. */
  async set(key: string, raw: unknown): Promise<PolicyView> {
    const def = POLICY_BY_KEY[key];
    if (!def) throw new BadRequestException(`Unknown policy: ${key}`);
    let value: PolicyValue;
    try {
      value = coercePolicyValue(def, raw);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    await this.tenantTx.run(async (m) => {
      await m.query(
        `INSERT INTO tenant_policy (tenant_id, key, value)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2::jsonb)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
      await this.audit.recordWith(m, { action: 'POLICY_SET', resource: 'tenant_policy', resourceId: key, newValue: { value } });
    });
    await this.invalidate();
    return { ...def, value, isOverride: true };
  }

  /** Remove a tenant override → revert to the registry default. */
  async reset(key: string): Promise<PolicyView> {
    const def = POLICY_BY_KEY[key];
    if (!def) throw new BadRequestException(`Unknown policy: ${key}`);
    await this.tenantTx.run(async (m) => {
      await m.query('DELETE FROM tenant_policy WHERE key = $1', [key]);
      await this.audit.recordWith(m, { action: 'POLICY_RESET', resource: 'tenant_policy', resourceId: key });
    });
    await this.invalidate();
    return { ...def, value: def.default, isOverride: false };
  }

  private async invalidate(): Promise<void> {
    const id = RequestContext.tenantId();
    if (id) await this.redis.del(this.cacheKey(id)).catch(() => undefined);
  }
}
