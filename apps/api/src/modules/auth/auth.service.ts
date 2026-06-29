import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import type { AppConfig } from '@metaxperts/config';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { RbacService } from '../rbac/rbac.service';
import { RefreshError, RefreshTokenService } from './refresh-token.service';
import { TwoFactorService } from './two-factor.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

/** Returned by login when the account has 2FA enabled — exchange `ticket` + a code at /auth/2fa/verify. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  ticket: string;
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
    private readonly rbac: RbacService,
    private readonly twofa: TwoFactorService,
  ) {}

  /** Authenticate by email/password. Issues tokens directly, or — when the account has 2FA enabled —
   * returns a short-lived challenge to be completed at `/auth/2fa/verify`. */
  async login(email: string, password: string): Promise<TokenPair | TwoFactorChallenge> {
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

    // Second factor: if the account has 2FA enabled, don't issue tokens yet — hand back a short-lived
    // challenge ticket. The session is only minted once /auth/2fa/verify confirms the code.
    const twofaRows = (await this.tenantTx.runFor(user.tenant_id, (m) =>
      m.query('SELECT twofa_enabled FROM users WHERE id = $1', [user.id]),
    )) as Array<{ twofa_enabled: boolean }>;
    if (twofaRows[0]?.twofa_enabled) {
      return { twoFactorRequired: true, ticket: this.signTicket(user.id, user.tenant_id) };
    }

    return this.finishLogin(user.id, user.tenant_id);
  }

  /** Complete a 2FA login: validate the challenge ticket + TOTP/recovery code, then issue tokens. */
  async verifyTwoFactor(ticket: string, code: string): Promise<TokenPair> {
    let payload: { sub?: string; tenantId?: string; purpose?: string };
    try {
      payload = this.jwt.verify(ticket, { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }) });
    } catch {
      throw new UnauthorizedException('Invalid or expired two-factor session');
    }
    if (payload.purpose !== '2fa' || !payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Invalid two-factor session');
    }
    const ok = await this.twofa.verifyForUser(payload.sub, payload.tenantId, code);
    if (!ok) throw new UnauthorizedException('Invalid two-factor code');
    await this.assertTenantActive(payload.tenantId);
    return this.finishLogin(payload.sub, payload.tenantId);
  }

  /** Stamp last-login, resolve effective roles/permissions, and mint the token pair. */
  private async finishLogin(userId: string, tenantId: string): Promise<TokenPair> {
    const rows = (await this.tenantTx.runFor(tenantId, async (m) => {
      await m.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
      return m.query('SELECT roles FROM users WHERE id = $1', [userId]);
    })) as Array<{ roles: string[] }>;
    const assigned = rows[0]?.roles ?? [];
    const [roles, perms] = await Promise.all([
      this.rbac.effectiveBuiltinRoles(tenantId, assigned),
      this.rbac.effectivePermissionsForUser(tenantId, assigned),
    ]);
    return this.issueTokens(userId, tenantId, roles, perms);
  }

  /** Sign a short-lived (5m) challenge ticket that authorizes only the 2FA verify step. */
  private signTicket(userId: string, tenantId: string): string {
    return this.jwt.sign(
      { sub: userId, tenantId, purpose: '2fa' },
      { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }), expiresIn: '5m' },
    );
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

    const [roles, perms] = await Promise.all([
      this.rbac.effectiveBuiltinRoles(record.tenantId, current.roles ?? []),
      this.rbac.effectivePermissionsForUser(record.tenantId, current.roles ?? []),
    ]);
    const signed = this.signAccess(record.userId, record.tenantId, roles, perms);
    return {
      accessToken: signed,
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

  private async issueTokens(
    userId: string,
    tenantId: string,
    roles: string[],
    perms: string[],
  ): Promise<TokenPair> {
    const { token } = await this.refreshTokens.issue(userId, tenantId);
    const signed = this.signAccess(userId, tenantId, roles, perms);
    return {
      accessToken: signed,
      refreshToken: token,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  private signAccess(userId: string, tenantId: string, roles: string[], perms: string[]): string {
    return this.jwt.sign(
      { sub: userId, tenantId, roles, perms },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      },
    );
  }
}
