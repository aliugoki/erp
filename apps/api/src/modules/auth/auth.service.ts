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

    await this.tenantTx.runFor(user.tenant_id, (manager) =>
      manager.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]),
    );

    return this.issueTokens(user.id, user.tenant_id);
  }

  /** Rotate a refresh token (with reuse detection) and mint a fresh access token. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      const { record, next } = await this.refreshTokens.rotate(refreshToken);
      const accessToken = this.signAccess(record.userId, record.tenantId);
      return {
        accessToken,
        refreshToken: next.token,
        tokenType: 'Bearer',
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      };
    } catch (err) {
      if (err instanceof RefreshError) throw new UnauthorizedException(err.message);
      throw err;
    }
  }

  /** Revoke the refresh token's family (logout). Idempotent. */
  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.revokeByToken(refreshToken);
  }

  private async issueTokens(userId: string, tenantId: string): Promise<TokenPair> {
    const { token } = await this.refreshTokens.issue(userId, tenantId);
    return {
      accessToken: this.signAccess(userId, tenantId),
      refreshToken: token,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  private signAccess(userId: string, tenantId: string): string {
    return this.jwt.sign(
      { sub: userId, tenantId },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      },
    );
  }
}
