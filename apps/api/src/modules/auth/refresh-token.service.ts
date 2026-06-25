import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@metaxperts/config';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

export interface RefreshRecord {
  userId: string;
  tenantId: string;
  familyId: string;
  used: boolean;
}

export interface IssuedRefresh {
  token: string;
  familyId: string;
}

/**
 * Opaque, single-use, rotating refresh tokens backed by Redis (ADR-006).
 *
 * Each token belongs to a "family" created at login. Refreshing rotates the token within its family.
 * Presenting an already-used (rotated) token is treated as theft: the ENTIRE family is revoked
 * (reuse detection). Tokens expire after the configured TTL.
 */
@Injectable()
export class RefreshTokenService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<AppConfig, true>,
  ) {
    this.ttlSeconds = config.get('JWT_REFRESH_TTL_SECONDS', { infer: true });
  }

  private tokenKey(token: string): string {
    return `rt:${token}`;
  }
  private familyKey(familyId: string): string {
    return `fam:${familyId}`;
  }
  private userKey(userId: string): string {
    return `usr:${userId}`;
  }

  /** Issue a brand-new token + family (login). */
  async issue(userId: string, tenantId: string): Promise<IssuedRefresh> {
    const familyId = randomUUID();
    const token = await this.store(userId, tenantId, familyId);
    return { token, familyId };
  }

  /** Rotate: validate the presented token, revoke-family on reuse, else mint a successor. */
  async rotate(token: string): Promise<{ record: RefreshRecord; next: IssuedRefresh }> {
    const record = await this.get(token);
    if (!record) {
      throw new RefreshError('Invalid or expired refresh token');
    }
    if (record.used) {
      // Reuse of a rotated token → likely theft. Burn the whole family.
      await this.revokeFamily(record.familyId);
      throw new RefreshError('Refresh token reuse detected; session revoked');
    }
    // Mark the presented token used (kept until family revocation/TTL so reuse is detectable).
    await this.redis.set(
      this.tokenKey(token),
      JSON.stringify({ ...record, used: true }),
      'EX',
      this.ttlSeconds,
    );
    const nextToken = await this.store(record.userId, record.tenantId, record.familyId);
    return { record, next: { token: nextToken, familyId: record.familyId } };
  }

  /** Revoke the family that a token belongs to (logout). No-op if the token is unknown. */
  async revokeByToken(token: string): Promise<void> {
    const record = await this.get(token);
    if (record) await this.revokeFamily(record.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    const tokens = await this.redis.smembers(this.familyKey(familyId));
    const keys = tokens.map((t) => this.tokenKey(t));
    if (keys.length) await this.redis.del(...keys);
    await this.redis.del(this.familyKey(familyId));
  }

  /** Revoke EVERY session of a user across all devices — used after a password change/reset so old
   * sessions can't outlive the credential. Best-effort: a missing user index is simply a no-op. */
  async revokeAllForUser(userId: string): Promise<void> {
    const families = await this.redis.smembers(this.userKey(userId));
    for (const familyId of families) await this.revokeFamily(familyId);
    await this.redis.del(this.userKey(userId));
  }

  private async get(token: string): Promise<RefreshRecord | null> {
    const raw = await this.redis.get(this.tokenKey(token));
    return raw ? (JSON.parse(raw) as RefreshRecord) : null;
  }

  private async store(userId: string, tenantId: string, familyId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const record: RefreshRecord = { userId, tenantId, familyId, used: false };
    await this.redis
      .multi()
      .set(this.tokenKey(token), JSON.stringify(record), 'EX', this.ttlSeconds)
      .sadd(this.familyKey(familyId), token)
      .expire(this.familyKey(familyId), this.ttlSeconds)
      // Index families by user so a password change can revoke every session at once.
      .sadd(this.userKey(userId), familyId)
      .expire(this.userKey(userId), this.ttlSeconds)
      .exec();
    return token;
  }
}

/** Thrown for any refresh failure; the controller maps it to 401. */
export class RefreshError extends Error {}
