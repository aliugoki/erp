import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { AuditService } from '../audit/audit.service';
import {
  ALL_FEATURE_KEYS,
  FEATURE_MODULES,
  type PlanTemplate,
  PLAN_TEMPLATES,
  moduleKeyOf,
} from './feature-registry';

const CACHE_TTL_SECONDS = 60;

/**
 * Resolves and mutates per-tenant feature entitlements (ADR-009). Reads are cached in Redis (short
 * TTL + explicit invalidation on toggle) so the FeatureGuard stays cheap on the hot path.
 */
@Injectable()
export class FeatureService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tenantTx: TenantTransactionService,
    private readonly audit: AuditService,
  ) {}

  private cacheKey(tenantId: string): string {
    return `feat:${tenantId}`;
  }

  /** The set of enabled feature keys for a tenant (cached). */
  async enabledKeys(tenantId: string): Promise<Set<string>> {
    const cached = await this.redis.get(this.cacheKey(tenantId)).catch(() => null);
    if (cached) return new Set(JSON.parse(cached) as string[]);

    const rows = (await this.tenantTx.runFor(tenantId, (m) =>
      m.query('SELECT feature_key FROM tenant_feature_entitlement WHERE enabled = true'),
    )) as Array<{ feature_key: string }>;
    const keys = rows.map((r) => r.feature_key);
    await this.redis
      .set(this.cacheKey(tenantId), JSON.stringify(keys), 'EX', CACHE_TTL_SECONDS)
      .catch(() => undefined);
    return new Set(keys);
  }

  async isEnabled(tenantId: string, featureKey: string): Promise<boolean> {
    return (await this.enabledKeys(tenantId)).has(featureKey);
  }

  /** Catalog annotated with this tenant's enabled flags — drives the web nav. */
  async catalogForTenant(tenantId: string) {
    const enabled = await this.enabledKeys(tenantId);
    return FEATURE_MODULES.map((mod) => ({
      key: mod.key,
      name: mod.name,
      description: mod.description,
      enabled: enabled.has(mod.key),
      features: mod.features.map((f) => ({ ...f, enabled: enabled.has(f.key) })),
    }));
  }

  /** Enable/disable a feature for a tenant. Enabling a sub-feature also enables its module. */
  async setEnabled(tenantId: string, featureKey: string, enabled: boolean): Promise<void> {
    if (!ALL_FEATURE_KEYS.has(featureKey)) {
      throw new BadRequestException(`Unknown feature key: ${featureKey}`);
    }
    await this.tenantTx.runFor(tenantId, async (manager) => {
      await this.upsert(manager, tenantId, featureKey, enabled);
      // Dependency: a sub-feature requires its module to be on.
      if (enabled) {
        const modKey = moduleKeyOf(featureKey);
        if (modKey !== featureKey) await this.upsert(manager, tenantId, modKey, true);
      }
      await this.audit.recordWith(manager, {
        action: 'FEATURE_TOGGLE',
        resource: 'tenant_feature_entitlement',
        resourceId: featureKey,
        newValue: { enabled },
      });
    });
    await this.redis.del(this.cacheKey(tenantId)).catch(() => undefined);
  }

  /** Apply a plan template's defaults. Runs inside the provisioning transaction (manager + tenant). */
  async applyPlan(manager: EntityManager, tenantId: string, plan: PlanTemplate): Promise<void> {
    for (const key of PLAN_TEMPLATES[plan]) {
      await this.upsert(manager, tenantId, key, true, true);
    }
  }

  private upsert(
    manager: EntityManager,
    tenantId: string,
    featureKey: string,
    enabled: boolean,
    insertOnly = false,
  ): Promise<unknown> {
    const onConflict = insertOnly
      ? 'DO NOTHING'
      : 'DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()';
    return manager.query(
      `INSERT INTO tenant_feature_entitlement (tenant_id, feature_key, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, feature_key) ${onConflict}`,
      [tenantId, featureKey, enabled],
    );
  }
}
