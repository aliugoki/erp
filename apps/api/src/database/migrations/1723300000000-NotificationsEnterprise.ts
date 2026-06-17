import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Notifications, completed. Enriches the `notification` row with severity, category, a deep-link, and
 * an archive flag, and adds per-user, per-category channel preferences (`notification_preference`):
 * a user can mute a category in-app and opt in/out of email. Additive + idempotent — the existing
 * feed/consumer keep working; new columns default to the prior behaviour (INFO / system / no link).
 */
export class NotificationsEnterprise1723300000000 implements MigrationInterface {
  name = 'NotificationsEnterprise1723300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "severity" text NOT NULL DEFAULT 'INFO'`);
    await q.query(`ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'system'`);
    await q.query(`ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "link" text`);
    await q.query(`ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz`);
    await q.query(`ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "ck_notification_severity"`);
    await q.query(`ALTER TABLE "notification" ADD CONSTRAINT "ck_notification_severity"
      CHECK ("severity" IN ('INFO','SUCCESS','WARNING','ERROR'))`);
    // Full-feed lookup (all states) newest-first.
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_notification_feed" ON "notification" ("tenant_id","user_id","created_at")`);

    await q.query(
      createTenantTableSql('notification_preference', [
        '"user_id" uuid NOT NULL',
        '"category" text NOT NULL',
        '"in_app" boolean NOT NULL DEFAULT true',
        '"email" boolean NOT NULL DEFAULT false',
      ]),
    );
    await q.query(`ALTER TABLE "notification_preference" ADD CONSTRAINT "uq_notification_preference_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE UNIQUE INDEX "uq_notif_pref" ON "notification_preference" ("tenant_id","user_id","category")`);
    for (const stmt of enableTenantRlsSql('notification_preference')) await q.query(stmt);
    await q.query(grantAppUserSql('notification_preference'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "notification_preference" CASCADE`);
    await q.query(`DROP INDEX IF EXISTS "ix_notification_feed"`);
    await q.query(`ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "ck_notification_severity"`);
    for (const c of ['archived_at', 'link', 'category', 'severity']) {
      await q.query(`ALTER TABLE "notification" DROP COLUMN IF EXISTS "${c}"`);
    }
  }
}
