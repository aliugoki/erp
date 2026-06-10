import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, disableTenantRlsSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Users table (Chunk 2.1). Tenant-scoped + RLS like everything else, BUT login must resolve a user
 * across tenants before any tenant context exists. That single cross-tenant read is done through a
 * narrow SECURITY DEFINER function (`auth_lookup_user`) granted only to app_user — never by relaxing
 * RLS on the table itself. Email is globally unique (case-insensitive).
 */
export class Users1718100000000 implements MigrationInterface {
  name = 'Users1718100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      createTenantTableSql('users', [
        '"email" text NOT NULL',
        '"password_hash" text NOT NULL',
        '"is_active" boolean NOT NULL DEFAULT true',
        '"last_login_at" timestamptz',
      ]),
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_email_lower" ON "users" (lower("email"))`,
    );
    for (const stmt of enableTenantRlsSql('users')) await queryRunner.query(stmt);
    await queryRunner.query(grantAppUserSql('users'));

    // Pre-authentication lookup: runs with the function owner's privileges (bypassing RLS) and is the
    // ONLY cross-tenant read of users. Returns just what login needs.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION auth_lookup_user(p_email text)
      RETURNS TABLE(id uuid, tenant_id uuid, password_hash text, is_active boolean)
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $$
        SELECT id, tenant_id, password_hash, is_active
        FROM users
        WHERE lower(email) = lower(p_email) AND deleted_at IS NULL
        LIMIT 1
      $$;
    `);
    await queryRunner.query(`REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO app_user`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS auth_lookup_user(text)`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_email_lower"`);
    for (const stmt of disableTenantRlsSql('users')) await queryRunner.query(stmt);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
