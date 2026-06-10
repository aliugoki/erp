/**
 * Reusable SQL for tenant isolation via Postgres Row-Level Security (ADR-002).
 *
 * Every future module migration calls `enableTenantRlsSql(table)` on its tenant-owned tables. The
 * policy compares the row's `tenant_id` to the per-transaction GUC `app.tenant_id`, set via
 * `set_config('app.tenant_id', <uuid>, true)` (transaction-local — required under PgBouncer
 * transaction pooling). When the GUC is unset/empty, `NULLIF(..., '')::uuid` is NULL, so the
 * comparison is never true and the query returns ZERO rows — a forgotten WHERE cannot leak.
 *
 * RLS only applies to NON-superuser, NON-BYPASSRLS roles (the app connects as `app_user`). FORCE ROW
 * LEVEL SECURITY also subjects the table owner, so ownership alone is not a bypass.
 */

/** Name of the tenancy canary table created by the kernel migration. */
export const PROBE_TABLE = 'tenant_probe';

const guc = "NULLIF(current_setting('app.tenant_id', true), '')::uuid";

/** Create a tenant-owned table with the standard BaseEntity columns (idempotent). */
export function createTenantTableSql(table: string, extraColumns: string[] = []): string {
  const cols = [
    '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid()',
    '"tenant_id" uuid NOT NULL',
    ...extraColumns,
    '"created_at" timestamptz NOT NULL DEFAULT now()',
    '"updated_at" timestamptz NOT NULL DEFAULT now()',
    '"deleted_at" timestamptz',
    '"created_by" uuid',
    '"updated_by" uuid',
  ];
  return `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${cols.join(',\n  ')}\n)`;
}

/** Enable + FORCE RLS and (re)create the tenant-isolation policy on a table (idempotent). */
export function enableTenantRlsSql(table: string, tenantColumn = 'tenant_id'): string[] {
  const policy = `${table}_tenant_isolation`;
  return [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS "${policy}" ON "${table}"`,
    `CREATE POLICY "${policy}" ON "${table}"\n` +
      `  USING ("${tenantColumn}" = ${guc})\n` +
      `  WITH CHECK ("${tenantColumn}" = ${guc})`,
  ];
}

/** Grant the app role CRUD on a table (default privileges usually cover this; explicit for safety). */
export function grantAppUserSql(table: string, role = 'app_user'): string {
  return `GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO ${role}`;
}

/** Reverse of enableTenantRlsSql (for migration `down`). */
export function disableTenantRlsSql(table: string): string[] {
  const policy = `${table}_tenant_isolation`;
  return [
    `DROP POLICY IF EXISTS "${policy}" ON "${table}"`,
    `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`,
    `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`,
  ];
}
