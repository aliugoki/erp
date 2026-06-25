import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { RbacService } from '../rbac/rbac.service';

export interface UserView {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
}

export interface UserRow {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  roles: string[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly auth: AuthService,
  ) {}

  /** Look up a user by id WITHIN the caller's tenant. RLS makes a cross-tenant id simply "not found". */
  async findByIdInTenant(id: string): Promise<UserView> {
    const rows = (await this.tenantTx.run((manager) =>
      manager.query('SELECT id, email, roles, is_active FROM users WHERE id = $1', [id]),
    )) as Array<{ id: string; email: string; roles: string[]; is_active: boolean }>;
    const user = rows[0];
    if (!user) throw new NotFoundException('User not found');
    return { id: user.id, email: user.email, roles: user.roles, isActive: user.is_active };
  }

  /** List the caller's own company's users (TENANT_ADMIN). RLS scopes to the caller's tenant. */
  async list(): Promise<UserRow[]> {
    return (await this.tenantTx.run((m) =>
      m.query(
        `SELECT id, email, roles, is_active AS "isActive",
                last_login_at AS "lastLoginAt", created_at AS "createdAt"
         FROM users WHERE deleted_at IS NULL ORDER BY created_at`,
      ),
    )) as UserRow[];
  }

  /** Add a user to the caller's own company with validated roles (TENANT_ADMIN). */
  async create(input: CreateUserInput): Promise<UserRow> {
    const tenantId = await this.currentTenantId();
    await this.rbac.assertAssignable(tenantId, input.roles);
    const passwordHash = await argon2.hash(input.password);
    try {
      return await this.tenantTx.run(async (m) => {
        const rows = (await m.query(
          `INSERT INTO users (tenant_id, email, password_hash, is_active, roles)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, true, $3)
           RETURNING id, email, roles, is_active AS "isActive",
                     last_login_at AS "lastLoginAt", created_at AS "createdAt"`,
          [input.email.toLowerCase(), passwordHash, `{${input.roles.join(',')}}`],
        )) as UserRow[];
        const created = rows[0];
        if (!created) throw new Error('User insert returned no row');
        await this.audit.recordWith(m, {
          action: 'USER_CREATE',
          resource: 'users',
          resourceId: created.id,
          newValue: { email: input.email, roles: input.roles },
        });
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`A user with email "${input.email}" already exists`);
      throw err;
    }
  }

  /** Replace a user's roles (TENANT_ADMIN), validated against built-in + this tenant's custom roles. */
  async setRoles(id: string, roles: string[]): Promise<{ id: string; roles: string[] }> {
    const tenantId = await this.currentTenantId();
    await this.rbac.assertAssignable(tenantId, roles);
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE users SET roles = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id, `{${roles.join(',')}}`],
      )) as Array<{ id: string }>;
      if (!rows[0]) throw new NotFoundException('User not found');
      await this.audit.recordWith(m, { action: 'USER_SET_ROLES', resource: 'users', resourceId: id, newValue: { roles } });
      // Apply immediately by revoking sessions (otherwise it would take effect on next token refresh).
      await this.auth.revokeUserSessions(id);
      return { id, roles };
    });
  }

  /** Reset a user's password (TENANT_ADMIN) and revoke their sessions. */
  async resetPassword(id: string, newPassword: string): Promise<{ id: string }> {
    const passwordHash = await argon2.hash(newPassword);
    const updated = (await this.tenantTx.run((m) =>
      m.query(
        'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING id',
        [passwordHash, id],
      ),
    )) as Array<{ id: string }>;
    if (!updated[0]) throw new NotFoundException('User not found');
    await this.auth.revokeUserSessions(id);
    return { id };
  }

  /** Activate/deactivate a user, recording the before/after in the audit trail (same transaction). */
  async setActive(id: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
    const result = await this.tenantTx.run(async (manager) => {
      const rows = (await manager.query('SELECT id, is_active FROM users WHERE id = $1', [id])) as Array<{
        id: string;
        is_active: boolean;
      }>;
      const existing = rows[0];
      if (!existing) throw new NotFoundException('User not found');

      await manager.query('UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2', [isActive, id]);
      await this.audit.recordWith(manager, {
        action: 'USER_SET_ACTIVE',
        resource: 'users',
        resourceId: id,
        oldValue: { isActive: existing.is_active },
        newValue: { isActive },
      });
      return { id, isActive };
    });
    if (!isActive) await this.auth.revokeUserSessions(id);
    return result;
  }

  private async currentTenantId(): Promise<string> {
    const rows = (await this.tenantTx.run((m) =>
      m.query(`SELECT current_setting('app.tenant_id', true) AS t`),
    )) as Array<{ t: string }>;
    const id = rows[0]?.t;
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
