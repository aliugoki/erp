import type { MigrationInterface, QueryRunner } from 'typeorm';
import { grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Tenants registry (Chunk 2.3). Platform-level table — no RLS — written only via SUPER_ADMIN
 * provisioning. No FK from users.tenant_id yet (existing seeded users predate the table); the FK is
 * added once provisioning is the sole path to create users.
 */
export class Tenants1718300000000 implements MigrationInterface {
  name = 'Tenants1718300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenants_slug" ON "tenants" ("slug")`);
    await queryRunner.query(grantAppUserSql('tenants'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenants"`);
  }
}
