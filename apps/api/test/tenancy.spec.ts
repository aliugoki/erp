/**
 * Tenancy kernel integration test (the Chunk 1.4 gate).
 *
 * Proves Postgres RLS isolates tenants at the DATABASE for the app's non-superuser role:
 *   - tenant A sees only A's rows; tenant B sees only B's rows;
 *   - with NO tenant context set, a query returns ZERO rows (a forgotten WHERE cannot leak);
 *   - a write that targets a different tenant is rejected by the policy's WITH CHECK.
 *
 * Setup/teardown run as the owner (direct). The proof runs as `app_user` (direct), the same
 * RLS-subject role the app uses through PgBouncer. Requires the infra DB to be up.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PROBE_TABLE,
  createTenantTableSql,
  enableTenantRlsSql,
  grantAppUserSql,
} from '../src/database/sql/tenancy.sql';

for (const candidate of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../../../.env'),
]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

let owner: Client;
let app: Client;

/** Run a unit of work inside a transaction with the tenant GUC set (transaction-local). */
async function asTenant<T>(
  client: Client,
  tenantId: string | null,
  work: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    if (tenantId !== null) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

describe('tenancy kernel — Postgres RLS isolation', () => {
  beforeAll(async () => {
    if (!ownerUrl) throw new Error('MIGRATION_DATABASE_URL/DATABASE_URL not set');
    owner = new Client({ connectionString: ownerUrl });
    await owner.connect();

    // Establish the canary table + RLS (idempotent — same helpers the migration uses).
    await owner.query(createTenantTableSql(PROBE_TABLE, ['"name" varchar NOT NULL']));
    for (const stmt of enableTenantRlsSql(PROBE_TABLE)) await owner.query(stmt);
    await owner.query(grantAppUserSql(PROBE_TABLE));
    await owner.query(`TRUNCATE "${PROBE_TABLE}"`);

    // app_user connects to the SAME Postgres directly (the RLS-subject role).
    const u = new URL(ownerUrl);
    app = new Client({
      host: u.hostname,
      port: Number(u.port),
      database: u.pathname.replace(/^\//, ''),
      user: 'app_user',
      password: 'app_pass',
    });
    await app.connect();

    // Seed one row per tenant, each within its own tenant context.
    await asTenant(app, TENANT_A, () =>
      app.query(`INSERT INTO "${PROBE_TABLE}" (tenant_id, name) VALUES ($1, $2)`, [TENANT_A, 'A-row']),
    );
    await asTenant(app, TENANT_B, () =>
      app.query(`INSERT INTO "${PROBE_TABLE}" (tenant_id, name) VALUES ($1, $2)`, [TENANT_B, 'B-row']),
    );
  });

  afterAll(async () => {
    if (owner) {
      await owner.query(`TRUNCATE "${PROBE_TABLE}"`).catch(() => undefined);
      await owner.end();
    }
    if (app) await app.end();
  });

  it('tenant A sees only tenant A rows', async () => {
    const rows = await asTenant(app, TENANT_A, async () => {
      const r = await app.query(`SELECT tenant_id, name FROM "${PROBE_TABLE}"`);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(TENANT_A);
    expect(rows[0].name).toBe('A-row');
  });

  it('tenant B sees only tenant B rows', async () => {
    const rows = await asTenant(app, TENANT_B, async () => {
      const r = await app.query(`SELECT tenant_id, name FROM "${PROBE_TABLE}"`);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(TENANT_B);
  });

  it('with NO tenant context, a query returns ZERO rows (RLS denies)', async () => {
    const r = await app.query(`SELECT count(*)::int AS n FROM "${PROBE_TABLE}"`);
    expect(r.rows[0].n).toBe(0);
  });

  it('a cross-tenant write is rejected by the policy (WITH CHECK)', async () => {
    await expect(
      asTenant(app, TENANT_A, () =>
        // In tenant A's context, try to write a row owned by tenant B.
        app.query(`INSERT INTO "${PROBE_TABLE}" (tenant_id, name) VALUES ($1, $2)`, [TENANT_B, 'evil']),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('superuser/owner total row count confirms both rows really exist (RLS, not emptiness)', async () => {
    const r = await owner.query(`SELECT count(*)::int AS n FROM "${PROBE_TABLE}"`);
    expect(r.rows[0].n).toBe(2);
  });
});
