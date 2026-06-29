import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';

const ISSUER = 'MetaXperts ERP';
const RECOVERY_COUNT = 10;
// Tolerate ±30s (one time-step) of clock skew between server and authenticator app.
const SKEW_SECONDS = 30;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface TwoFaRow {
  email: string;
  twofa_enabled: boolean;
  twofa_secret: string | null;
  twofa_recovery_codes: string[] | null;
}

/**
 * TOTP-based two-factor auth. Secrets and SHA-256-hashed recovery codes live on the `users` row
 * (RLS-scoped). A secret is stored at setup but only enforced once `enabled` flips true (after the
 * user proves possession with a valid code). Recovery codes are single-use.
 */
@Injectable()
export class TwoFactorService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  private row(userId: string, tenantId: string): Promise<TwoFaRow | undefined> {
    return this.tenantTx.runFor(tenantId, async (m) => {
      const rows = (await m.query(
        `SELECT email, twofa_enabled, twofa_secret, twofa_recovery_codes FROM users WHERE id = $1`,
        [userId],
      )) as TwoFaRow[];
      return rows[0];
    });
  }

  async status(userId: string, tenantId: string): Promise<{ enabled: boolean }> {
    const r = await this.row(userId, tenantId);
    return { enabled: !!r?.twofa_enabled };
  }

  /** Generate (and persist, disabled) a fresh secret; return the otpauth URI for QR provisioning. */
  async setup(userId: string, tenantId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const r = await this.row(userId, tenantId);
    if (r?.twofa_enabled) throw new BadRequestException('Two-factor is already enabled');
    const seed = generateSecret();
    await this.tenantTx.runFor(tenantId, (m) =>
      m.query(`UPDATE users SET twofa_secret = $1, twofa_enabled = false, twofa_recovery_codes = NULL, updated_at = now() WHERE id = $2`, [seed, userId]),
    );
    return { secret: seed, otpauthUrl: generateURI({ issuer: ISSUER, label: r?.email ?? 'user', secret: seed }) };
  }

  /** Verify the first code against the pending secret, enable 2FA, and return one-time recovery codes. */
  async enable(userId: string, tenantId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const r = await this.row(userId, tenantId);
    if (!r?.twofa_secret) throw new BadRequestException('Start setup first');
    if (r.twofa_enabled) throw new BadRequestException('Two-factor is already enabled');
    if (!(await this.checkTotp(r.twofa_secret, code))) throw new BadRequestException('Invalid code');
    const codes = Array.from({ length: RECOVERY_COUNT }, () => formatRecovery(randomBytes(5).toString('hex')));
    await this.tenantTx.runFor(tenantId, (m) =>
      m.query(`UPDATE users SET twofa_enabled = true, twofa_recovery_codes = $1::jsonb, updated_at = now() WHERE id = $2`, [
        JSON.stringify(codes.map(sha256)),
        userId,
      ]),
    );
    return { recoveryCodes: codes };
  }

  /** Disable 2FA after proving possession (a current TOTP code or a recovery code). */
  async disable(userId: string, tenantId: string, code: string): Promise<void> {
    const ok = await this.verifyForUser(userId, tenantId, code);
    if (!ok) throw new BadRequestException('Invalid code');
    await this.tenantTx.runFor(tenantId, (m) =>
      m.query(`UPDATE users SET twofa_enabled = false, twofa_secret = NULL, twofa_recovery_codes = NULL, updated_at = now() WHERE id = $1`, [userId]),
    );
  }

  /** True if `code` is a valid current TOTP or an unused recovery code (which is then consumed). */
  async verifyForUser(userId: string, tenantId: string, code: string): Promise<boolean> {
    const r = await this.row(userId, tenantId);
    if (!r?.twofa_secret) return false;
    const cleaned = code.replace(/\s+/g, '');
    if (await this.checkTotp(r.twofa_secret, cleaned)) return true;
    // Recovery code fallback: match a stored hash, then consume it.
    const hashes = r.twofa_recovery_codes ?? [];
    const h = sha256(cleaned.toLowerCase());
    if (!hashes.includes(h)) return false;
    const remaining = hashes.filter((x) => x !== h);
    await this.tenantTx.runFor(tenantId, (m) =>
      m.query(`UPDATE users SET twofa_recovery_codes = $1::jsonb WHERE id = $2`, [JSON.stringify(remaining), userId]),
    );
    return true;
  }

  private async checkTotp(seed: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    try {
      const res = await verify({ token: code, secret: seed, epochTolerance: SKEW_SECONDS });
      return res.valid;
    } catch {
      throw new UnauthorizedException('Two-factor verification failed');
    }
  }
}

/** Render a recovery code as lowercase hex grouped `xxxxx-xxxxx` for readability. */
function formatRecovery(hex: string): string {
  return `${hex.slice(0, 5)}-${hex.slice(5, 10)}`;
}
