import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FX-aware general ledger.
 *
 * - `finance_account.currency` — optional denomination (ISO-4217) for accounts that hold a foreign
 *   balance (e.g. a USD bank account). NULL = the tenant's base currency.
 * - `finance_journal_entry.fc_*` — when a line is booked in a foreign currency, the GL still stores
 *   the BASE-currency amount in `debit_minor`/`credit_minor` (so all reporting stays single-currency),
 *   while `fc_currency` / `fc_amount_minor` / `fx_rate_micro` retain the original foreign amount and the
 *   rate it was booked at. Period-end revaluation reads these to compute unrealised FX gain/loss.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS only.
 */
export class FxGl1721300000000 implements MigrationInterface {
  name = 'FxGl1721300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_account" ADD COLUMN IF NOT EXISTS "currency" text`);
    await queryRunner.query(`ALTER TABLE "finance_journal_entry" ADD COLUMN IF NOT EXISTS "fc_currency" text`);
    await queryRunner.query(`ALTER TABLE "finance_journal_entry" ADD COLUMN IF NOT EXISTS "fc_amount_minor" bigint`);
    await queryRunner.query(`ALTER TABLE "finance_journal_entry" ADD COLUMN IF NOT EXISTS "fx_rate_micro" bigint`);
    // Index the foreign lines so revaluation (which scans only fc_currency IS NOT NULL) stays cheap.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_finance_je_fc" ON "finance_journal_entry" ("account_id") WHERE "fc_currency" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_finance_je_fc"`);
    await queryRunner.query(`ALTER TABLE "finance_journal_entry" DROP COLUMN IF EXISTS "fx_rate_micro"`);
    await queryRunner.query(`ALTER TABLE "finance_journal_entry" DROP COLUMN IF EXISTS "fc_amount_minor"`);
    await queryRunner.query(`ALTER TABLE "finance_journal_entry" DROP COLUMN IF EXISTS "fc_currency"`);
    await queryRunner.query(`ALTER TABLE "finance_account" DROP COLUMN IF EXISTS "currency"`);
  }
}
