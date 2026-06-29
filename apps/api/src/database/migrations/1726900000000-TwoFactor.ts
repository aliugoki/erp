import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two-factor authentication (TOTP) columns on `users`. `twofa_secret` holds the base32 TOTP secret
 * (set at setup, but only enforced once `twofa_enabled` is true); `twofa_recovery_codes` is a JSONB
 * array of SHA-256 hashes of one-time recovery codes (consumed on use). Idempotent.
 */
export class TwoFactor1726900000000 implements MigrationInterface {
  name = 'TwoFactor1726900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twofa_enabled" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twofa_secret" text`);
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twofa_recovery_codes" jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "twofa_recovery_codes"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "twofa_secret"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "twofa_enabled"`);
  }
}
