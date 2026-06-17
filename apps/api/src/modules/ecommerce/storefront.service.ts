import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/request-context/request-context';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { TenantsService } from '../tenants/tenants.service';

type Row = Record<string, unknown>;

/**
 * Resolves a public storefront request (reached by the tenant slug, no JWT) to a tenant and seeds the
 * per-request tenant context so the normal RLS path applies. Only a PUBLISHED store is reachable — an
 * unknown slug or an unpublished store is a flat 404, leaking nothing about which tenants exist.
 */
@Injectable()
export class StorefrontService {
  constructor(
    private readonly tenants: TenantsService,
    private readonly tenantTx: TenantTransactionService,
  ) {}

  /** Resolve `slug` → tenant, set the RLS context for the rest of this request, and require a published
   * store. Call this first in every storefront handler before touching tenant-scoped data. */
  async resolve(slug: string): Promise<void> {
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) throw new NotFoundException('Store not found');
    RequestContext.set({ tenantId: tenant.id });
    const published = await this.tenantTx.runFor(tenant.id, async (m) => {
      const rows = (await m.query(`SELECT published FROM ec_store WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
      return !!rows[0]?.published;
    });
    if (!published) throw new NotFoundException('Store not found');
  }
}
