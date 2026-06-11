import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Notifications schema (Chunk 5.1). Tenant-scoped (RLS) in-app notifications addressed to a user.
 * The consumer creates a row in response to domain events (e.g. crm.deal_closed → the assignee);
 * email is a best-effort async side-channel, so a row here is the durable record. `source_event_id`
 * is unique per (tenant, user) so a redelivered event never creates a duplicate notification.
 */
export class Notifications1719300000000 implements MigrationInterface {
  name = 'Notifications1719300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      createTenantTableSql('notification', [
        '"user_id" uuid NOT NULL',
        '"type" text NOT NULL',
        '"title" text NOT NULL',
        '"body" text',
        '"read_at" timestamptz',
        '"source_event_id" uuid',
      ]),
    );
    // Unread feed lookup: a user's most recent unread notifications.
    await q.query(`CREATE INDEX "ix_notification_user" ON "notification" ("tenant_id", "user_id", "read_at")`);
    // Idempotency: one notification per source event per recipient (partial — only when set).
    await q.query(
      `CREATE UNIQUE INDEX "uq_notification_source" ON "notification" ("tenant_id", "user_id", "source_event_id")
       WHERE "source_event_id" IS NOT NULL`,
    );

    for (const stmt of enableTenantRlsSql('notification')) await q.query(stmt);
    await q.query(grantAppUserSql('notification'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "notification" CASCADE`);
  }
}
