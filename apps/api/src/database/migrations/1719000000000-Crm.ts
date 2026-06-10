import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * CRM module schema (Chunk 3.4). Tenant-scoped (RLS), composite (tenant_id, id) FKs, deal value as
 * bigint minor units (ADR-007). Deal stage is a constrained enum; reaching CLOSED_WON emits
 * `crm.deal_closed` to the outbox (in the service).
 */
export class Crm1719000000000 implements MigrationInterface {
  name = 'Crm1719000000000';

  public async up(q: QueryRunner): Promise<void> {
    // Clients
    await q.query(
      createTenantTableSql('crm_client', [
        '"company_name" text NOT NULL',
        '"industry" text',
        '"website" text',
        `"status" text NOT NULL DEFAULT 'PROSPECT'`,
      ]),
    );
    await q.query(`ALTER TABLE "crm_client" ADD CONSTRAINT "uq_crm_client_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`ALTER TABLE "crm_client" ADD CONSTRAINT "ck_crm_client_status" CHECK ("status" IN ('PROSPECT','ACTIVE','INACTIVE'))`);

    // Contacts
    await q.query(
      createTenantTableSql('crm_contact', [
        '"client_id" uuid NOT NULL',
        '"name" text NOT NULL',
        '"email" text',
        '"phone" text',
        '"is_primary" boolean NOT NULL DEFAULT false',
      ]),
    );
    await q.query(`ALTER TABLE "crm_contact" ADD CONSTRAINT "uq_crm_contact_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX "ix_crm_contact_client" ON "crm_contact" ("tenant_id","client_id")`);
    await q.query(
      `ALTER TABLE "crm_contact" ADD CONSTRAINT "fk_crm_contact_client"
       FOREIGN KEY ("tenant_id","client_id") REFERENCES "crm_client"("tenant_id","id") ON DELETE CASCADE`,
    );

    // Deals
    await q.query(
      createTenantTableSql('crm_deal', [
        '"client_id" uuid NOT NULL',
        '"title" text NOT NULL',
        '"value_minor" bigint NOT NULL DEFAULT 0',
        `"currency" text NOT NULL DEFAULT 'PKR'`,
        `"stage" text NOT NULL DEFAULT 'LEAD'`,
        '"expected_close_date" date',
        '"assigned_to" uuid',
      ]),
    );
    await q.query(`ALTER TABLE "crm_deal" ADD CONSTRAINT "uq_crm_deal_tenant_id" UNIQUE ("tenant_id","id")`);
    await q.query(`CREATE INDEX "ix_crm_deal_stage" ON "crm_deal" ("tenant_id","stage")`);
    await q.query(`CREATE INDEX "ix_crm_deal_client" ON "crm_deal" ("tenant_id","client_id")`);
    await q.query(
      `ALTER TABLE "crm_deal" ADD CONSTRAINT "ck_crm_deal_stage"
       CHECK ("stage" IN ('LEAD','QUALIFIED','PROPOSAL','NEGOTIATION','CLOSED_WON','CLOSED_LOST'))`,
    );
    await q.query(
      `ALTER TABLE "crm_deal" ADD CONSTRAINT "fk_crm_deal_client"
       FOREIGN KEY ("tenant_id","client_id") REFERENCES "crm_client"("tenant_id","id") ON DELETE CASCADE`,
    );

    for (const table of ['crm_client', 'crm_contact', 'crm_deal']) {
      for (const stmt of enableTenantRlsSql(table)) await q.query(stmt);
      await q.query(grantAppUserSql(table));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['crm_deal', 'crm_contact', 'crm_client']) {
      await q.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
