/**
 * Ecommerce customer-email consumer test. Drives the consumer against the real DB through the
 * IdempotentConsumer, proving:
 *  - ecommerce.order_placed queues exactly one confirmation email to the buyer (idempotent),
 *  - ecommerce.order_status_changed queues a status email (e.g. SHIPPED),
 *  - a status with no customer email (PENDING) queues nothing,
 *  - the email goes to the order's customer address with the right subject.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BaseEvent, EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../src/common/tenant/tenant-transaction.service';
import { IdempotentConsumer } from '../src/modules/consumers/idempotent-consumer.service';
import { EcommerceService } from '../src/modules/ecommerce/ecommerce.service';
import { EcommerceEmailConsumer } from '../src/modules/ecommerce/ecommerce-email.consumer';
import type { EmailQueueService } from '../src/modules/notifications/email-queue.service';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../.env')]) {
  if (existsSync(c)) { loadDotenv({ path: c }); break; }
}

const T = 'eeee0000-eeee-eeee-eeee-eeeeeeeeeeee';

let ds: DataSource;
let idem: IdempotentConsumer;
let consumer: EcommerceEmailConsumer;
let sent: Array<{ to: string; subject: string; text: string }>;
let orderId: string;

const placed = (): BaseEvent => ({
  id: randomUUID(), type: EVENT_TYPES.ECOMMERCE_ORDER_PLACED, tenantId: T, occurredAt: '2026-06-18T00:00:00Z',
  payload: { orderId, orderNo: 'ORD-000099', clientId: null, paymentMethod: 'COD', totalMinor: 480_000, taxMinor: 0, shippingMinor: 30_000, cogsMinor: 0, currency: 'PKR', lineCount: 1 },
});
const statusChanged = (status: string): BaseEvent => ({
  id: randomUUID(), type: EVENT_TYPES.ECOMMERCE_ORDER_STATUS_CHANGED, tenantId: T, occurredAt: '2026-06-18T01:00:00Z',
  payload: { orderId, orderNo: 'ORD-000099', status, previousStatus: 'PENDING' },
});

beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  ds = new DataSource({ type: 'postgres', url, synchronize: false, logging: false });
  await ds.initialize();
  const tenantTx = new TenantTransactionService(ds);
  idem = new IdempotentConsumer(undefined as never, tenantTx, undefined as never);
  const ec = new EcommerceService(undefined as never, undefined as never, undefined as never, undefined as never);
  sent = [];
  const email = { enqueue: async (m: { to: string; subject: string; text: string }) => { sent.push(m); } } as unknown as EmailQueueService;
  const cfg = { get: () => false } as never; // config unused once we call the handler directly
  consumer = new EcommerceEmailConsumer(undefined as never, cfg, ec, email);
});

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await ds.query(`DELETE FROM ec_order WHERE tenant_id=$1`, [T]);
  await ds.query(`DELETE FROM ec_store WHERE tenant_id=$1`, [T]);
  await ds.query(`DELETE FROM processed_event WHERE tenant_id=$1`, [T]);
  await ds.query(`INSERT INTO ec_store (tenant_id, name, currency, published) VALUES ($1,'Shop Co','PKR',true)`, [T]);
  const rows = (await ds.query(
    `INSERT INTO ec_order (tenant_id, order_no, customer_name, customer_email, payment_method, payment_status, total_minor, currency, status)
     VALUES ($1,'ORD-000099','Ada Lovelace','ada@buyer.test','COD','UNPAID',480000,'PKR','PENDING') RETURNING id`,
    [T],
  )) as Array<{ id: string }>;
  orderId = rows[0]!.id;
  sent.length = 0;
});

describe('ecommerce customer emails', () => {
  it('order_placed queues exactly one confirmation to the buyer, idempotent under redelivery', async () => {
    const e = placed();
    expect(await idem.handleOnce('ecommerce-email-placed', e, (ev, m) => consumer.onOrderEvent(ev, m, 'placed'))).toBe('processed');
    expect(await idem.handleOnce('ecommerce-email-placed', e, (ev, m) => consumer.onOrderEvent(ev, m, 'placed'))).toBe('duplicate');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ada@buyer.test');
    expect(sent[0].subject).toBe('Shop Co — order ORD-000099 confirmed');
  });

  it('order_status_changed SHIPPED queues a shipping email', async () => {
    await idem.handleOnce('ecommerce-email-status', statusChanged('SHIPPED'), (ev, m) => consumer.onOrderEvent(ev, m, null));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ada@buyer.test');
    expect(sent[0].subject).toContain('shipped');
  });

  it('a status with no customer email (PENDING) queues nothing', async () => {
    await idem.handleOnce('ecommerce-email-status', statusChanged('PENDING'), (ev, m) => consumer.onOrderEvent(ev, m, null));
    expect(sent).toHaveLength(0);
  });
});
