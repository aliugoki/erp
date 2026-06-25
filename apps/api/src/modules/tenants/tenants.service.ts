import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { AuthService } from '../auth/auth.service';
import { Role, toRoles } from '../auth/rbac/role.enum';
import { FeatureService } from '../features/feature.service';
import type { PlanTemplate } from '../features/feature-registry';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import type { TenantStatus } from './entities/tenant.entity';

export interface ProvisionResult {
  tenant: { id: string; name: string; slug: string; status: string };
  admin: { id: string; email: string };
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
}

export interface TenantStats {
  total: number;
  active: number;
  suspended: number;
}

export interface TenantUser {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
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
    private readonly auth: AuthService,
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

  /** List every company in the platform registry, newest first. SUPER_ADMIN-only (guarded at the
   * route). The `tenants` table is not RLS-scoped, so this is a direct cross-tenant read. */
  async list(): Promise<TenantSummary[]> {
    return (await this.dataSource.query(
      `SELECT id, name, slug, status, created_at AS "createdAt" FROM tenants ORDER BY created_at DESC`,
    )) as TenantSummary[];
  }

  /** Activate or suspend a company. A suspended company's users are blocked at login/refresh
   * (enforced in AuthService). SUPER_ADMIN-only (guarded at the route). */
  async setStatus(id: string, status: TenantStatus): Promise<ProvisionResult['tenant']> {
    await this.findById(id); // 404 if missing
    await this.dataSource.query(`UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1`, [
      id,
      status,
    ]);
    return this.findById(id);
  }

  /** Platform-wide company counts for the dashboard KPI strip. */
  async stats(): Promise<TenantStats> {
    const rows = (await this.dataSource.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'suspended')::int AS suspended
       FROM tenants`,
    )) as TenantStats[];
    return rows[0] ?? { total: 0, active: 0, suspended: 0 };
  }

  /** Rename a company. The slug is left untouched so existing storefront links keep working. */
  async rename(id: string, name: string): Promise<ProvisionResult['tenant']> {
    await this.findById(id); // 404 if missing
    await this.dataSource.query(`UPDATE tenants SET name = $2, updated_at = now() WHERE id = $1`, [id, name]);
    return this.findById(id);
  }

  /** Re-apply a feature plan to an existing company (upgrade/downgrade). */
  async applyPlanToTenant(id: string, plan: PlanTemplate): Promise<{ id: string; plan: PlanTemplate }> {
    await this.findById(id); // 404 if the company doesn't exist
    await this.tenantTx.runFor(id, (manager) => this.features.applyPlan(manager, id, plan));
    return { id, plan };
  }

  /** The module/feature catalog for a specific company (SUPER_ADMIN view). */
  async listFeatures(id: string) {
    await this.findById(id);
    return this.features.catalogForTenant(id);
  }

  /** Enable/disable a single feature for a specific company (SUPER_ADMIN only). Module entitlements
   * are managed by the platform operator per company, not by the company itself. */
  async setFeature(id: string, key: string, enabled: boolean): Promise<{ key: string; enabled: boolean }> {
    await this.findById(id);
    await this.features.setEnabled(id, key, enabled);
    return { key, enabled };
  }

  /** List a company's users (SUPER_ADMIN drills into a tenant). RLS-scoped to that tenant. */
  async listUsers(id: string): Promise<TenantUser[]> {
    await this.findById(id);
    const rows = (await this.tenantTx.runFor(id, (m) =>
      m.query(
        `SELECT id, email, roles, is_active AS "isActive",
                last_login_at AS "lastLoginAt", created_at AS "createdAt"
         FROM users WHERE deleted_at IS NULL ORDER BY created_at`,
      ),
    )) as TenantUser[];
    return rows;
  }

  /** Add a user to a company. Defaults to TENANT_ADMIN. SUPER_ADMIN-only (guarded at the route). */
  async addUser(id: string, dto: CreateTenantUserDto): Promise<TenantUser> {
    await this.findById(id);
    const roles = toRoles(dto.roles && dto.roles.length ? dto.roles : [Role.TENANT_ADMIN]);
    const passwordHash = await argon2.hash(dto.password);
    try {
      const rows = (await this.tenantTx.runFor(id, (m) =>
        m.query(
          `INSERT INTO users (tenant_id, email, password_hash, is_active, roles)
           VALUES ($1, $2, $3, true, $4)
           RETURNING id, email, roles, is_active AS "isActive",
                     last_login_at AS "lastLoginAt", created_at AS "createdAt"`,
          [id, dto.email.toLowerCase(), passwordHash, `{${roles.join(',')}}`],
        ),
      )) as TenantUser[];
      if (!rows[0]) throw new Error('User insert returned no row');
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`A user with email "${dto.email}" already exists`);
      throw err;
    }
  }

  /** Reset a company user's password and revoke all their sessions. SUPER_ADMIN-only. */
  async resetUserPassword(id: string, userId: string, newPassword: string): Promise<{ id: string }> {
    await this.findById(id);
    const passwordHash = await argon2.hash(newPassword);
    const updated = (await this.tenantTx.runFor(id, (m) =>
      m.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 RETURNING id', [
        passwordHash,
        userId,
      ]),
    )) as Array<{ id: string }>;
    if (!updated[0]) throw new NotFoundException('User not found');
    await this.auth.revokeUserSessions(userId);
    return { id: userId };
  }

  /** Activate/deactivate a company user. SUPER_ADMIN-only. */
  async setUserStatus(id: string, userId: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
    await this.findById(id);
    const updated = (await this.tenantTx.runFor(id, (m) =>
      m.query('UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING id', [
        isActive,
        userId,
      ]),
    )) as Array<{ id: string }>;
    if (!updated[0]) throw new NotFoundException('User not found');
    if (!isActive) await this.auth.revokeUserSessions(userId);
    return { id: userId, isActive };
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
