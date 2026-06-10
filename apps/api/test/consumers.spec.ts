/**
 * Consumer reliability test (Chunk 4.3 gate). Proves idempotent handling (same event twice → effect
 * once), retry-with-backoff to a DLQ (a throwing handler lands in dlq_event), and DLQ requeue.
 * Requires Postgres + RabbitMQ (infra) up.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BaseEvent } from '@metaxperts/shared';
import { RequestContext } from '../src/common/request-context/request-context';
import { TenantTransactionService } from '../src/common/tenant/tenant-transaction.service';
import { EventBusService } from '../src/modules/eventbus/event-bus.service';
import { DlqService } from '../src/modules/consumers/dlq.service';
import { IdempotentConsumer } from '../src/modules/consumers/idempotent-consumer.service';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../.env')]) {
  if (existsSync(c)) { loadDotenv({ path: c }); break; }
}

const TENANT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
let ds: DataSource;
let bus: EventBusService;
let dlq: DlqService;
let consumer: IdempotentConsumer;

const fakeConfig = () => ({ get: () => process.env.RABBITMQ_URL ?? 'amqp://metaxperts:metaxperts@127.0.0.1:5672' }) as never;
const event = (type: string, payload: unknown = {}): BaseEvent => ({
  id: randomUUID(), type, tenantId: TENANT, occurredAt: '2026-06-10T00:00:00Z', payload,
});
const dlqCount = async (et: string) =>
  Number((await ds.query(`SELECT count(*)::int c FROM dlq_event WHERE tenant_id=$1 AND event_type=$2`, [TENANT, et]))[0].c);

beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  ds = new DataSource({ type: 'postgres', url, synchronize: false, logging: false });
  await ds.initialize();
  const tenantTx = new TenantTransactionService(ds);
  bus = new EventBusService(fakeConfig());
  await bus.connect();
  dlq = new DlqService(tenantTx, bus);
  consumer = new IdempotentConsumer(bus, tenantTx, dlq);
  // Ensure the 'test' domain exchange exists (publish targets it directly in these tests).
  await (await bus.getChannel()).assertExchange('test', 'topic', { durable: true });
});
afterAll(async () => {
  if (ds?.isInitialized) {
    await ds.query(`DELETE FROM processed_event WHERE tenant_id=$1`, [TENANT]).catch(() => undefined);
    await ds.query(`DELETE FROM dlq_event WHERE tenant_id=$1`, [TENANT]).catch(() => undefined);
    await ds.query(`DELETE FROM tenant_probe WHERE tenant_id=$1`, [TENANT]).catch(() => undefined);
    await ds.destroy();
  }
  if (bus) await bus.close();
});
beforeEach(async () => {
  await ds.query(`DELETE FROM processed_event WHERE tenant_id=$1`, [TENANT]);
  await ds.query(`DELETE FROM dlq_event WHERE tenant_id=$1`, [TENANT]);
  await ds.query(`DELETE FROM tenant_probe WHERE tenant_id=$1`, [TENANT]);
});

describe('IdempotentConsumer', () => {
  it('applies a handler effect exactly once for a redelivered event', async () => {
    const evt = event('test.idem.v1');
    let calls = 0;
    const handler = async (e: BaseEvent, m: import('typeorm').EntityManager) => {
      calls++;
      await m.query(`INSERT INTO tenant_probe (tenant_id, name) VALUES (current_setting('app.tenant_id')::uuid, $1)`, [e.id]);
    };

    expect(await consumer.handleOnce('c-idem', evt, handler)).toBe('processed');
    expect(await consumer.handleOnce('c-idem', evt, handler)).toBe('duplicate'); // redelivery

    expect(calls).toBe(1);
    const probes = Number((await ds.query(`SELECT count(*)::int c FROM tenant_probe WHERE tenant_id=$1`, [TENANT]))[0].c);
    expect(probes).toBe(1); // effect applied once
  });

  it('retries a failing handler with backoff and parks it in the DLQ', async () => {
    await consumer.register({
      eventType: 'test.fail.v1',
      consumer: 'c-fail',
      maxAttempts: 3,
      baseDelayMs: 40,
      handler: async () => {
        throw new Error('always fails');
      },
    });

    await bus.publish(event('test.fail.v1', { x: 1 }));

    // Wait for: initial + 2 retries (40 + 80ms backoff) -> DLQ.
    let count = 0;
    for (let i = 0; i < 40 && count === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      count = await dlqCount('test.fail.v1');
    }
    expect(count).toBe(1);
    const row = (await ds.query(
      `SELECT attempts, reason FROM dlq_event WHERE tenant_id=$1 AND event_type='test.fail.v1' LIMIT 1`,
      [TENANT],
    ))[0];
    expect(row.attempts).toBe(3);
    expect(row.reason).toContain('always fails');
  });

  it('requeues a DLQ entry (republishes and removes the row)', async () => {
    await dlq.park(TENANT, {
      consumer: 'c-x', eventId: randomUUID(), eventType: 'test.requeue.v1',
      payload: { a: 1 }, originalEvent: event('test.requeue.v1', { a: 1 }), reason: 'manual', attempts: 3,
    });
    const before = (await ds.query(`SELECT id FROM dlq_event WHERE tenant_id=$1 AND event_type='test.requeue.v1'`, [TENANT]))[0];
    expect(before).toBeTruthy();

    // requeue reads the tenant from the request context (as the /admin/dlq endpoint does).
    await RequestContext.run({ requestId: 't', tenantId: TENANT }, () => dlq.requeue(before.id));
    expect(await dlqCount('test.requeue.v1')).toBe(0); // removed after requeue
  });
});
