import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import type { AppConfig } from '@metaxperts/config';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { RefreshError, RefreshTokenService } from './refresh-token.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

interface AuthUserRow {
  id: string;
  tenant_id: string;
  password_hash: string;
  is_active: boolean;
  roles: string[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly refreshTokens: RefreshTokenService,
    private readonly tenantTx: TenantTransactionService,
  ) {}

  /** Authenticate by email/password and issue an access JWT + rotating refresh token. */
  async login(email: string, password: string): Promise<TokenPair> {
    // Pre-auth lookup crosses tenants, so it goes through a narrow SECURITY DEFINER function rather
    // than an RLS-scoped query (the app role can't see other tenants' rows).
    const rows = (await this.dataSource.query('SELECT * FROM auth_lookup_user($1)', [
      email.toLowerCase(),
    ])) as AuthUserRow[];
    const user = rows[0];

    // Verify even when the user is missing (constant-ish work) to blunt user enumeration / timing.
    const hash = user?.password_hash ?? '$argon2id$v=19$m=65536,t=3,p=4$invalidinvalidinvalid$invalid';
    const passwordOk = await argon2.verify(hash, password).catch(() => false);

    if (!user || !user.is_active || !passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.assertTenantActive(user.tenant_id);

    await this.tenantTx.runFor(user.tenant_id, (manager) =>
      manager.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]),
    );

    return this.issueTokens(user.id, user.tenant_id, user.roles ?? []);
  }

  /** Rotate a refresh token (with reuse detection) and mint a fresh access token. Roles are reloaded
   * from the DB so a role change or deactivation takes effect on the next refresh, not in 7 days. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let record: { userId: string; tenantId: string; familyId: string };
    let nextToken: string;
    try {
      const rotated = await this.refreshTokens.rotate(refreshToken);
      record = rotated.record;
      nextToken = rotated.next.token;
    } catch (err) {
      if (err instanceof RefreshError) throw new UnauthorizedException(err.message);
      throw err;
    }

    const rows = (await this.tenantTx.runFor(record.tenantId, (manager) =>
      manager.query('SELECT roles, is_active FROM users WHERE id = $1', [record.userId]),
    )) as Array<{ roles: string[]; is_active: boolean }>;
    const current = rows[0];
    if (!current || !current.is_active) {
      await this.refreshTokens.revokeByToken(nextToken);
      throw new UnauthorizedException('Account is no longer active');
    }
    try {
      await this.assertTenantActive(record.tenantId);
    } catch (err) {
      await this.refreshTokens.revokeByToken(nextToken);
      throw err;
    }

    return {
      accessToken: this.signAccess(record.userId, record.tenantId, current.roles ?? []),
      refreshToken: nextToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  /** Revoke the refresh token's family (logout). Idempotent. */
  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.revokeByToken(refreshToken);
  }

  /** Change the authenticated user's own password: verify the current one, store the new hash, then
   * revoke every session so the old credential can't outlive the change (forces re-login). */
  async changePassword(
    userId: string,
    tenantId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const rows = (await this.tenantTx.runFor(tenantId, (m) =>
      m.query('SELECT password_hash FROM users WHERE id = $1', [userId]),
    )) as Array<{ password_hash: string }>;
    const hash = rows[0]?.password_hash;
    const ok = hash ? await argon2.verify(hash, currentPassword).catch(() => false) : false;
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const newHash = await argon2.hash(newPassword);
    await this.tenantTx.runFor(tenantId, (m) =>
      m.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, userId]),
    );
    await this.refreshTokens.revokeAllForUser(userId);
  }

  /** Revoke every session of a user (used after a SUPER_ADMIN password reset). */
  async revokeUserSessions(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }

  /** Reject login/refresh for a suspended company. The synthetic platform tenant (the SUPER_ADMIN's
   * tenant_id) has no row in `tenants` → treated as active so platform operators are never locked
   * out. The `tenants` table is not RLS-scoped, so the app role can read it directly. */
  private async assertTenantActive(tenantId: string): Promise<void> {
    const rows = (await this.dataSource.query('SELECT status FROM tenants WHERE id = $1 LIMIT 1', [
      tenantId,
    ])) as Array<{ status: string }>;
    if (rows[0] && rows[0].status !== 'active') {
      throw new UnauthorizedException('Company account is suspended');
    }
  }

  private async issueTokens(userId: string, tenantId: string, roles: string[]): Promise<TokenPair> {
    const { token } = await this.refreshTokens.issue(userId, tenantId);
    return {
      accessToken: this.signAccess(userId, tenantId, roles),
      refreshToken: token,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  private signAccess(userId: string, tenantId: string, roles: string[]): string {
    return this.jwt.sign(
      { sub: userId, tenantId, roles },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      },
    );
  }
}
