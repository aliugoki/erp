/**
 * Idempotency store test (Chunk 7.2). Drives IdempotencyService against the real DB as app_user (RLS
 * subject) with random tenants (no cleanup, no collisions). Proves the claim/replay/in-progress/
 * mismatch/abort outcomes and tenant isolation.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantTransactionService } from '../src/common/tenant/tenant-transaction.service';
import { IdempotencyService } from '../src/modules/idempotency/idempotency.service';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../.env')]) {
  if (existsSync(c)) { loadDotenv({ path: c }); break; }
}

let ds: DataSource;
let svc: IdempotencyService;
const TA = randomUUID();
const TB = randomUUID();

beforeAll(async () => {
  ds = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL, synchronize: false, logging: false });
  await ds.initialize();
  svc = new IdempotencyService(new TenantTransactionService(ds));
});
afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

describe('IdempotencyService', () => {
  it('claims a new key, then replays the stored response on a duplicate', async () => {
    const key = randomUUID();
    expect((await svc.begin(TA, key, 'hash-1')).status).toBe('new');
    await svc.complete(TA, key, 201, { id: 'inv-1', total: 5000 });

    const replay = await svc.begin(TA, key, 'hash-1');
    expect(replay.status).toBe('replay');
    if (replay.status === 'replay') {
      expect(replay.statusCode).toBe(201);
      expect(replay.body).toEqual({ id: 'inv-1', total: 5000 });
    }
  });

  it('reports in_progress for an unfinished claim', async () => {
    const key = randomUUID();
    expect((await svc.begin(TA, key, 'h')).status).toBe('new');
    expect((await svc.begin(TA, key, 'h')).status).toBe('in_progress'); // not completed yet
  });

  it('reports mismatch when a completed key is reused with a different request', async () => {
    const key = randomUUID();
    await svc.begin(TA, key, 'hash-A');
    await svc.complete(TA, key, 201, { ok: true });
    expect((await svc.begin(TA, key, 'hash-B')).status).toBe('mismatch');
  });

  it('abort releases an uncompleted claim so the client can retry', async () => {
    const key = randomUUID();
    expect((await svc.begin(TA, key, 'h')).status).toBe('new');
    await svc.abort(TA, key);
    expect((await svc.begin(TA, key, 'h')).status).toBe('new'); // claimable again
  });

  it('is tenant-scoped: the same key is independent across tenants', async () => {
    const key = randomUUID();
    await svc.begin(TA, key, 'h');
    await svc.complete(TA, key, 201, { tenant: 'A' });
    // Tenant B has never seen this key → it's new for B.
    expect((await svc.begin(TB, key, 'h')).status).toBe('new');
    const a = await svc.begin(TA, key, 'h');
    expect(a.status).toBe('replay');
    if (a.status === 'replay') expect(a.body).toEqual({ tenant: 'A' });
  });
});
