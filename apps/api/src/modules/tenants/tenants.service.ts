import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { Role } from '../auth/rbac/role.enum';
import { FeatureService } from '../features/feature.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';

export interface ProvisionResult {
  tenant: { id: string; name: string; slug: string; status: string };
  admin: { id: string; email: string };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantTx: TenantTransactionService,
    private readonly features: FeatureService,
  ) {}

  /** Create a tenant and its first TENANT_ADMIN user. The admin row is written within the new
   * tenant's RLS context (WITH CHECK enforces the tenant_id). SUPER_ADMIN-only (guarded at the route). */
  async provision(dto: CreateTenantDto): Promise<ProvisionResult> {
    const slug = slugify(dto.name);

    let tenant: ProvisionResult['tenant'];
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, name, slug, status`,
        [dto.name, slug],
      )) as ProvisionResult['tenant'][];
      if (!rows[0]) throw new Error('Tenant insert returned no row');
      tenant = rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`Tenant slug "${slug}" already exists`);
      throw err;
    }

    const passwordHash = await argon2.hash(dto.adminPassword);
    let admin: ProvisionResult['admin'];
    try {
      admin = await this.tenantTx.runFor(tenant.id, async (manager) => {
        const rows = (await manager.query(
          `INSERT INTO users (tenant_id, email, password_hash, is_active, roles)
           VALUES ($1, $2, $3, true, $4) RETURNING id, email`,
          [tenant.id, dto.adminEmail.toLowerCase(), passwordHash, `{${Role.TENANT_ADMIN}}`],
        )) as ProvisionResult['admin'][];
        if (!rows[0]) throw new Error('User insert returned no row');
        // Seed the tenant's feature entitlements from the chosen plan, in the same transaction.
        await this.features.applyPlan(manager, tenant.id, dto.plan ?? 'business');
        return rows[0];
      });
    } catch (err) {
      // Roll back the orphaned tenant so provisioning is all-or-nothing.
      await this.dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
      if (isUniqueViolation(err)) {
        throw new ConflictException(`A user with email "${dto.adminEmail}" already exists`);
      }
      throw err;
    }

    return { tenant, admin };
  }

  /** Resolve an ACTIVE tenant by its public slug (used by the unauthenticated storefront). Null if
   * not found / suspended — the `tenants` table is not RLS-scoped, so this is a direct lookup. */
  async findBySlug(slug: string): Promise<{ id: string; name: string; slug: string; status: string } | null> {
    const rows = (await this.dataSource.query(
      `SELECT id, name, slug, status FROM tenants WHERE slug = $1 AND status = 'active' LIMIT 1`,
      [slug],
    )) as ProvisionResult['tenant'][];
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<ProvisionResult['tenant']> {
    const rows = (await this.dataSource.query(
      `SELECT id, name, slug, status FROM tenants WHERE id = $1`,
      [id],
    )) as ProvisionResult['tenant'][];
    if (!rows[0]) throw new NotFoundException('Tenant not found');
    return rows[0];
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
