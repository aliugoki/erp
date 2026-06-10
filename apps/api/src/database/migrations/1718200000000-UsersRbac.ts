import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds RBAC columns to users and extends the pre-auth lookup to return roles, so the access token can
 * carry them (Chunk 2.2). The lookup function's return type changes, so it is dropped and recreated.
 */
export class UsersRbac1718200000000 implements MigrationInterface {
  name = 'UsersRbac1718200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles" text[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id" uuid`);

    await queryRunner.query(`DROP FUNCTION IF EXISTS auth_lookup_user(text)`);
    await queryRunner.query(`
      CREATE FUNCTION auth_lookup_user(p_email text)
      RETURNS TABLE(id uuid, tenant_id uuid, password_hash text, is_active boolean, roles text[])
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $$
        SELECT id, tenant_id, password_hash, is_active, roles
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
    await queryRunner.query(`
      CREATE FUNCTION auth_lookup_user(p_email text)
      RETURNS TABLE(id uuid, tenant_id uuid, password_hash text, is_active boolean)
      LANGUAGE sql SECURITY DEFINER SET search_path = public
      AS $$ SELECT id, tenant_id, password_hash, is_active FROM users
            WHERE lower(email) = lower(p_email) AND deleted_at IS NULL LIMIT 1 $$;
    `);
    await queryRunner.query(`REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO app_user`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "employee_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "roles"`);
  }
}
