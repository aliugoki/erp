import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { RequestContext } from '../../common/request-context/request-context';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { AuditService } from '../audit/audit.service';
import { ALL_ROLES } from '../auth/rbac/role.enum';
import {
  CAPABILITY_ROLES,
  TENANT_ASSIGNABLE_BUILTIN_ROLES,
  capabilityCatalog,
} from '../auth/rbac/role-metadata';

const CACHE_TTL_SECONDS = 60;
const BUILTIN = new Set<string>(ALL_ROLES);
const CAPABILITY = new Set<string>(CAPABILITY_ROLES);
const TENANT_ASSIGNABLE = new Set<string>(TENANT_ASSIGNABLE_BUILTIN_ROLES);

export interface CustomRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  memberRoles: string[];
}

export interface CreateCustomRoleInput {
  name: string;
  description?: string;
  memberRoles: string[];
}

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

/**
 * Per-tenant composite RBAC (Path 1). A custom role bundles built-in capability roles; a user's
 * assigned roles are expanded to the union of built-ins at login so the existing @Roles checks
 * enforce them. Custom-role member maps are cached in Redis (short TTL + explicit invalidation).
 */
@Injectable()
export class RbacService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tenantTx: TenantTransactionService,
    private readonly audit: AuditService,
  ) {}

  private cacheKey(tenantId: string): string {
    return `roles:${tenantId}`;
  }

  /** The capability building blocks a company admin can combine (name/description/permissions). */
  capabilities() {
    return capabilityCatalog();
  }

  /** Map of custom-role key → member built-in roles for a tenant (cached). */
  private async memberMap(tenantId: string): Promise<Record<string, string[]>> {
    const cached = await this.redis.get(this.cacheKey(tenantId)).catch(() => null);
    if (cached) return JSON.parse(cached) as Record<string, string[]>;
    const rows = (await this.tenantTx.runFor(tenantId, (m) =>
      m.query('SELECT key, member_roles FROM tenant_role WHERE deleted_at IS NULL'),
    )) as Array<{ key: string; member_roles: string[] }>;
    const map: Record<string, string[]> = {};
    for (const r of rows) map[r.key] = r.member_roles ?? [];
    await this.redis.set(this.cacheKey(tenantId), JSON.stringify(map), 'EX', CACHE_TTL_SECONDS).catch(() => undefined);
    return map;
  }

  /** Expand assigned roles (built-in + custom) to the union of built-in roles for the access token.
   * Built-ins pass through; custom keys expand to their members; unknown/deleted keys are ignored. */
  async effectiveBuiltinRoles(tenantId: string, assigned: readonly string[]): Promise<string[]> {
    const out = new Set<string>();
    const customKeys: string[] = [];
    for (const r of assigned) {
      if (BUILTIN.has(r)) out.add(r);
      else customKeys.push(r);
    }
    if (customKeys.length) {
      const map = await this.memberMap(tenantId);
      for (const k of customKeys) for (const m of map[k] ?? []) if (BUILTIN.has(m)) out.add(m);
    }
    return [...out];
  }

  /** Validate that every role a TENANT_ADMIN wants to assign is allowed (built-in non-admin, a
   * co-admin, or an existing custom role in this tenant) — never SUPER_ADMIN or an unknown key. */
  async assertAssignable(tenantId: string, roles: readonly string[]): Promise<void> {
    if (!roles.length) throw new BadRequestException('A user must have at least one role');
    const map = await this.memberMap(tenantId);
    for (const r of roles) {
      const ok = TENANT_ASSIGNABLE.has(r) || Object.prototype.hasOwnProperty.call(map, r);
      if (!ok) throw new BadRequestException(`Role "${r}" cannot be assigned`);
    }
  }

  // ── Custom-role CRUD (tenant-scoped, runs in the caller's context) ──────────────

  async listCustom(): Promise<CustomRole[]> {
    return (await this.tenantTx.run((m) =>
      m.query(
        `SELECT id, key, name, description, member_roles AS "memberRoles"
         FROM tenant_role WHERE deleted_at IS NULL ORDER BY name`,
      ),
    )) as CustomRole[];
  }

  async createCustom(input: CreateCustomRoleInput): Promise<CustomRole> {
    const members = this.validateMembers(input.memberRoles);
    const key = slugify(input.name);
    if (!key || BUILTIN.has(input.name.toUpperCase().replace(/\s+/g, '_'))) {
      throw new BadRequestException('Invalid role name');
    }
    try {
      return await this.tenantTx.run(async (m) => {
        const rows = (await m.query(
          `INSERT INTO tenant_role (tenant_id, key, name, description, member_roles)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4)
           RETURNING id, key, name, description, member_roles AS "memberRoles"`,
          [key, input.name, input.description ?? null, `{${members.join(',')}}`],
        )) as CustomRole[];
        const created = rows[0];
        if (!created) throw new Error('Role insert returned no row');
        await this.audit.recordWith(m, { action: 'ROLE_CREATE', resource: 'tenant_role', resourceId: created.id, newValue: { key, members } });
        await this.invalidate();
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`A role named "${input.name}" already exists`);
      throw err;
    }
  }

  async updateCustom(id: string, input: CreateCustomRoleInput): Promise<CustomRole> {
    const members = this.validateMembers(input.memberRoles);
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE tenant_role SET name = $2, description = $3, member_roles = $4, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, key, name, description, member_roles AS "memberRoles"`,
        [id, input.name, input.description ?? null, `{${members.join(',')}}`],
      )) as CustomRole[];
      if (!rows[0]) throw new NotFoundException('Role not found');
      await this.audit.recordWith(m, { action: 'ROLE_UPDATE', resource: 'tenant_role', resourceId: id, newValue: { members } });
      await this.invalidate();
      return rows[0];
    });
  }

  async deleteCustom(id: string): Promise<{ id: string }> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE tenant_role SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id],
      )) as Array<{ id: string }>;
      if (!rows[0]) throw new NotFoundException('Role not found');
      await this.audit.recordWith(m, { action: 'ROLE_DELETE', resource: 'tenant_role', resourceId: id });
      await this.invalidate();
      return { id };
    });
  }

  private validateMembers(members: readonly string[]): string[] {
    const unique = [...new Set(members)];
    if (!unique.length) throw new BadRequestException('A custom role must include at least one capability');
    for (const r of unique) {
      if (!CAPABILITY.has(r)) throw new BadRequestException(`"${r}" is not a valid capability`);
    }
    return unique;
  }

  /** Invalidate the current tenant's cached member map (after any custom-role change). */
  private async invalidate(): Promise<void> {
    const id = RequestContext.tenantId();
    if (id) await this.redis.del(this.cacheKey(id)).catch(() => undefined);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
