import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Password-reset support for storefront customers — a one-time reset token (stored hashed) with an
 * expiry on `ec_customer`. Requesting a reset emails a link; resetting clears the token. Additive.
 */
export class EcommercePasswordReset1724800000000 implements MigrationInterface {
  name = 'EcommercePasswordReset1724800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ec_customer" ADD COLUMN IF NOT EXISTS "reset_token_hash" text`);
    await q.query(`ALTER TABLE "ec_customer" ADD COLUMN IF NOT EXISTS "reset_expires_at" timestamptz`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_ec_customer_reset" ON "ec_customer" ("reset_token_hash")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_ec_customer_reset"`);
    await q.query(`ALTER TABLE "ec_customer" DROP COLUMN IF EXISTS "reset_expires_at"`);
    await q.query(`ALTER TABLE "ec_customer" DROP COLUMN IF EXISTS "reset_token_hash"`);
  }
}
