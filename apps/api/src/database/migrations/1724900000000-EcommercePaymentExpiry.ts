import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payment-session expiry. A card order holds stock from placement; if the buyer never pays, an expiry
 * sweep cancels the order and restocks it. `expires_at` bounds how long a pending session (and its
 * stock hold) lives. Additive; existing rows stay null (never auto-expired).
 */
export class EcommercePaymentExpiry1724900000000 implements MigrationInterface {
  name = 'EcommercePaymentExpiry1724900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ec_payment" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_ec_payment_expiry" ON "ec_payment" ("tenant_id","status","expires_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_ec_payment_expiry"`);
    await q.query(`ALTER TABLE "ec_payment" DROP COLUMN IF EXISTS "expires_at"`);
  }
}
