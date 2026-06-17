import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Card-payment-terminal integration for POS. A register can drive a physical card machine through a
 * pluggable provider: NONE (cash/manual only), SIMULATED (built-in test approver), or BRIDGE (a local
 * agent on the cashier's PC that talks to the reader over the documented HTTP contract). Card tenders
 * additionally capture the scheme + last-4 for the receipt. Additive columns only — idempotent.
 */
export class PosTerminal1723100000000 implements MigrationInterface {
  name = 'PosTerminal1723100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_register" ADD COLUMN IF NOT EXISTS "card_terminal_provider" text NOT NULL DEFAULT 'NONE'`);
    await q.query(`ALTER TABLE "pos_register" ADD COLUMN IF NOT EXISTS "card_terminal_url" text`);
    await q.query(`ALTER TABLE "pos_register" DROP CONSTRAINT IF EXISTS "ck_pos_register_terminal"`);
    await q.query(`ALTER TABLE "pos_register" ADD CONSTRAINT "ck_pos_register_terminal"
      CHECK ("card_terminal_provider" IN ('NONE','SIMULATED','BRIDGE'))`);

    await q.query(`ALTER TABLE "pos_payment" ADD COLUMN IF NOT EXISTS "card_scheme" text`);
    await q.query(`ALTER TABLE "pos_payment" ADD COLUMN IF NOT EXISTS "card_last4" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_payment" DROP COLUMN IF EXISTS "card_last4"`);
    await q.query(`ALTER TABLE "pos_payment" DROP COLUMN IF EXISTS "card_scheme"`);
    await q.query(`ALTER TABLE "pos_register" DROP CONSTRAINT IF EXISTS "ck_pos_register_terminal"`);
    await q.query(`ALTER TABLE "pos_register" DROP COLUMN IF EXISTS "card_terminal_url"`);
    await q.query(`ALTER TABLE "pos_register" DROP COLUMN IF EXISTS "card_terminal_provider"`);
  }
}
