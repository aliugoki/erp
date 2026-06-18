import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Help Desk / customer-support module. Tickets flow through an SLA engine (first-response + resolution
 * targets per priority; the clock pauses while a ticket waits on the customer), carry a threaded
 * conversation (public replies + internal notes + system events), and can be assigned to an agent/team.
 * Optionally linked to a CRM account and/or an ecommerce order. Tenant-scoped (RLS).
 *
 * Tables: hd_sla_policy (per-priority targets), hd_team (+ hd_team_member), hd_ticket, hd_message,
 * hd_canned_response, hd_doc_seq (ticket numbering).
 */
export class Helpdesk1725000000000 implements MigrationInterface {
  name = 'Helpdesk1725000000000';

  public async up(q: QueryRunner): Promise<void> {
    const table = async (name: string, cols: string[]): Promise<void> => {
      await q.query(createTenantTableSql(name, cols));
      await q.query(`ALTER TABLE "${name}" ADD CONSTRAINT "uq_${name}_tenant_id" UNIQUE ("tenant_id","id")`);
      for (const stmt of enableTenantRlsSql(name)) await q.query(stmt);
      await q.query(grantAppUserSql(name));
    };

    // SLA targets per priority (minutes). One row per priority.
    await table('hd_sla_policy', [
      `"priority" text NOT NULL`,
      '"first_response_mins" integer NOT NULL',
      '"resolution_mins" integer NOT NULL',
      '"active" boolean NOT NULL DEFAULT true',
    ]);
    await q.query(`ALTER TABLE "hd_sla_policy" ADD CONSTRAINT "ck_hd_sla_priority" CHECK ("priority" IN ('LOW','MEDIUM','HIGH','URGENT'))`);
    await q.query(`CREATE UNIQUE INDEX "uq_hd_sla_priority" ON "hd_sla_policy" ("tenant_id","priority") WHERE deleted_at IS NULL`);

    // Agent teams.
    await table('hd_team', ['"name" text NOT NULL', '"description" text']);
    await table('hd_team_member', ['"team_id" uuid NOT NULL', '"user_id" uuid NOT NULL']);
    await q.query(`ALTER TABLE "hd_team_member" ADD CONSTRAINT "fk_hd_team_member_team"
      FOREIGN KEY ("tenant_id","team_id") REFERENCES "hd_team"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`CREATE UNIQUE INDEX "uq_hd_team_member" ON "hd_team_member" ("tenant_id","team_id","user_id")`);

    // Tickets.
    await table('hd_ticket', [
      '"ticket_no" text NOT NULL',
      '"subject" text NOT NULL',
      '"requester_name" text NOT NULL',
      '"requester_email" text NOT NULL',
      '"client_id" uuid',
      '"order_id" uuid',
      `"channel" text NOT NULL DEFAULT 'WEB'`,
      '"category" text',
      `"priority" text NOT NULL DEFAULT 'MEDIUM'`,
      `"status" text NOT NULL DEFAULT 'NEW'`,
      '"assigned_to" uuid',
      '"team_id" uuid',
      `"tags" text[] NOT NULL DEFAULT '{}'`,
      '"first_response_due_at" timestamptz',
      '"resolution_due_at" timestamptz',
      '"first_responded_at" timestamptz',
      '"resolved_at" timestamptz',
      '"closed_at" timestamptz',
      '"sla_paused_at" timestamptz',
      '"first_response_breached" boolean NOT NULL DEFAULT false',
      '"resolution_breached" boolean NOT NULL DEFAULT false',
      '"reopened_count" integer NOT NULL DEFAULT 0',
      '"csat_rating" integer',
      '"csat_comment" text',
      '"last_activity_at" timestamptz NOT NULL DEFAULT now()',
    ]);
    await q.query(`ALTER TABLE "hd_ticket" ADD CONSTRAINT "ck_hd_ticket_priority" CHECK ("priority" IN ('LOW','MEDIUM','HIGH','URGENT'))`);
    await q.query(`ALTER TABLE "hd_ticket" ADD CONSTRAINT "ck_hd_ticket_status" CHECK ("status" IN ('NEW','OPEN','PENDING','ON_HOLD','RESOLVED','CLOSED'))`);
    await q.query(`ALTER TABLE "hd_ticket" ADD CONSTRAINT "ck_hd_ticket_channel" CHECK ("channel" IN ('EMAIL','WEB','PHONE','CHAT'))`);
    await q.query(`ALTER TABLE "hd_ticket" ADD CONSTRAINT "ck_hd_ticket_csat" CHECK ("csat_rating" IS NULL OR "csat_rating" BETWEEN 1 AND 5)`);
    await q.query(`CREATE UNIQUE INDEX "uq_hd_ticket_no" ON "hd_ticket" ("tenant_id","ticket_no")`);
    await q.query(`CREATE INDEX "ix_hd_ticket_status" ON "hd_ticket" ("tenant_id","status")`);
    await q.query(`CREATE INDEX "ix_hd_ticket_assignee" ON "hd_ticket" ("tenant_id","assigned_to")`);
    await q.query(`CREATE INDEX "ix_hd_ticket_email" ON "hd_ticket" ("tenant_id", lower("requester_email"))`);

    // Conversation messages (public replies, internal notes, system events).
    await table('hd_message', [
      '"ticket_id" uuid NOT NULL',
      `"author_type" text NOT NULL DEFAULT 'AGENT'`,
      '"author_id" uuid',
      '"author_name" text NOT NULL',
      '"body" text NOT NULL',
      '"is_internal" boolean NOT NULL DEFAULT false',
    ]);
    await q.query(`ALTER TABLE "hd_message" ADD CONSTRAINT "fk_hd_message_ticket"
      FOREIGN KEY ("tenant_id","ticket_id") REFERENCES "hd_ticket"("tenant_id","id") ON DELETE CASCADE`);
    await q.query(`ALTER TABLE "hd_message" ADD CONSTRAINT "ck_hd_message_author" CHECK ("author_type" IN ('AGENT','CUSTOMER','SYSTEM'))`);
    await q.query(`CREATE INDEX "ix_hd_message_ticket" ON "hd_message" ("tenant_id","ticket_id")`);

    // Canned responses (macros).
    await table('hd_canned_response', ['"title" text NOT NULL', '"body" text NOT NULL']);

    // Ticket numbering.
    await table('hd_doc_seq', ['"doc_type" text NOT NULL', '"last_no" bigint NOT NULL DEFAULT 0']);
    await q.query(`CREATE UNIQUE INDEX "uq_hd_doc_seq" ON "hd_doc_seq" ("tenant_id","doc_type")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['hd_doc_seq', 'hd_canned_response', 'hd_message', 'hd_ticket', 'hd_team_member', 'hd_team', 'hd_sla_policy']) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
