/**
 * Outbox relay integration test (Chunk 4.1 gate). Drives OutboxRelay against the real Postgres
 * (owner connection, bypassing RLS) with an in-memory publisher. Proves exactly-once on the happy
 * path, no row lost when publishing fails, and crash-safety: rows locked by a relay that "dies"
 * (rolled-back tx) are re-published and never double-marked. Requires infra DB up.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../src/modules/outbox/relay/outbox-relay.service';
import type { OutboxEvent, Publisher } from '../src/modules/outbox/relay/publisher';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../.env')]) {
  if (existsSync(c)) { loadDotenv({ path: c }); break; }
}

const TENANT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
let ds: DataSource;

/** Records published event ids (to detect duplicates); can be set to fail. */
class CountingPublisher implements Publisher {
  ids: string[] = [];
  fail = false;
  async publish(e: OutboxEvent): Promise<void> {
    if (this.fail) throw new Error('publish boom');
    this.ids.push(e.id);
  }
  get unique(): number {
    return new Set(this.ids).size;
  }
}

async function seed(n: number): Promise<void> {
  // The relay processes ALL tenants' pending events, so clear the whole table to a known state
  // (this is a test DB; any leftover events from e2e runs are disposable).
  await ds.query(`DELETE FROM outbox_event`);
  for (let i = 0; i < n; i++) {
    await ds.query(
      `INSERT INTO outbox_event (tenant_id, type, payload) VALUES ($1, 'test.event', $2::jsonb)`,
      [TENANT, JSON.stringify({ n: i })],
    );
  }
}
const pendingCount = async () =>
  Number((await ds.query(`SELECT count(*)::int AS c FROM outbox_event WHERE tenant_id=$1 AND published_at IS NULL`, [TENANT]))[0].c);
const markedCount = async () =>
  Number((await ds.query(`SELECT count(*)::int AS c FROM outbox_event WHERE tenant_id=$1 AND published_at IS NOT NULL`, [TENANT]))[0].c);

beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL not set');
  ds = new DataSource({ type: 'postgres', url, synchronize: false, logging: false });
  await ds.initialize();
});
afterAll(async () => {
  if (ds?.isInitialized) {
    await ds.query(`DELETE FROM outbox_event WHERE tenant_id = $1`, [TENANT]).catch(() => undefined);
    await ds.destroy();
  }
});
beforeEach(() => seed(0));

describe('OutboxRelay', () => {
  it('publishes 100 pending events exactly once and marks them', async () => {
    await seed(100);
    const pub = new CountingPublisher();
    const relay = new OutboxRelay(ds, pub);
    const res = await relay.drain(25);
    expect(res.published).toBe(100);
    expect(pub.ids).toHaveLength(100);
    expect(pub.unique).toBe(100); // no duplicates
    expect(await pendingCount()).toBe(0);
    expect(await markedCount()).toBe(100);
  });

  it('loses no row when publishing fails, then publishes on retry', async () => {
    await seed(20);
    const pub = new CountingPublisher();
    const relay = new OutboxRelay(ds, pub);

    pub.fail = true;
    const failed = await relay.processBatch(100);
    expect(failed.published).toBe(0);
    expect(failed.failed).toBe(20);
    expect(await pendingCount()).toBe(20); // nothing lost, nothing marked
    expect(
      Number((await ds.query(`SELECT min(attempts)::int AS a FROM outbox_event WHERE tenant_id=$1`, [TENANT]))[0].a),
    ).toBe(1); // each attempt recorded

    pub.fail = false;
    const ok = await relay.drain(100);
    expect(ok.published).toBe(20);
    expect(await pendingCount()).toBe(0);
    expect(pub.unique).toBe(20);
  });

  it('is crash-safe: rows locked by a "dead" relay are re-published, never double-marked', async () => {
    await seed(30);
    const pub = new CountingPublisher();
    const relay = new OutboxRelay(ds, pub);

    // Simulate a relay that grabbed 10 rows (FOR UPDATE) then died without committing.
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    await qr.query(
      `SELECT id FROM outbox_event WHERE tenant_id=$1 AND published_at IS NULL ORDER BY occurred_at LIMIT 10 FOR UPDATE`,
      [TENANT],
    );

    // Another relay runs: SKIP LOCKED means it skips the 10 locked rows and publishes the other 20.
    const first = await relay.drain(100);
    expect(first.published).toBe(20);
    expect(await pendingCount()).toBe(10);

    // The first relay "crashes": its transaction rolls back, releasing the locks without marking.
    await qr.rollbackTransaction();
    await qr.release();

    // Now the 10 are picked up and published.
    const second = await relay.drain(100);
    expect(second.published).toBe(10);

    expect(pub.ids).toHaveLength(30);
    expect(pub.unique).toBe(30); // every event published exactly once across both relays
    expect(await pendingCount()).toBe(0);
    expect(await markedCount()).toBe(30);
  });
});
