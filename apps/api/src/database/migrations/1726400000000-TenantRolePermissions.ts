import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Path 2 Phase C: a custom role may now grant arbitrary fine-grained permissions directly (not only
 * bundle built-in capability roles). `permissions` holds catalog permission keys; effective access =
 * union of `member_roles`' permissions and this list. RLS already covers the table.
 */
export class TenantRolePermissions1726400000000 implements MigrationInterface {
  name = 'TenantRolePermissions1726400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "tenant_role" ADD COLUMN IF NOT EXISTS "permissions" text[] NOT NULL DEFAULT '{}'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "tenant_role" DROP COLUMN IF EXISTS "permissions"`);
  }
}
