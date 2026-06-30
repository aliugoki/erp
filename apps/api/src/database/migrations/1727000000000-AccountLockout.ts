import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account lockout state on `users`: a rolling count of consecutive failed sign-ins and, once the
 * threshold is hit, a `locked_until` cool-off timestamp. Reset on a successful login or admin unlock.
 * Idempotent.
 */
export class AccountLockout1727000000000 implements MigrationInterface {
  name = 'AccountLockout1727000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" int NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamptz`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "locked_until"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "failed_login_attempts"`);
  }
}
