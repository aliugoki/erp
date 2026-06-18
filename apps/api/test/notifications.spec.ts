/**
 * Notifications test (Chunk 5.1 gate). Drives the notifications consumer + service against the real
 * DB through the IdempotentConsumer, proving:
 *  - a crm.deal_closed event creates exactly one in-app notification for the deal's ASSIGNEE,
 *  - it is idempotent under redelivery (same event twice → one row),
 *  - an UNAVAILABLE email side-channel never blocks the durable in-app notification (graceful degrade),
 *  - unassigned deals produce no notification,
 *  - listUnread/markRead are correct and tenant-scoped.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BaseEvent, EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../src/common/tenant/tenant-transaction.service';
import { RequestContext } from '../src/common/request-context/request-context';
import { IdempotentConsumer } from '../src/modules/consumers/idempotent-consumer.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { NotificationsConsumer } from '../src/modules/notifications/notifications.consumer';
import type { EmailQueueService } from '../src/modules/notifications/email-queue.service';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../.env')]) {
  if (existsSync(c)) { loadDotenv({ path: c }); break; }
}

// Distinct tenant ids (not the aaaa/bbbb used by other specs) so parallel test files don't clobber
// each other's processed_event/notification rows in their beforeEach cleanup.
const TA = 'cccc0000-cccc-cccc-cccc-cccccccccccc';
const TB = 'dddd0000-dddd-dddd-dddd-dddddddddddd';
const CONSUMER = 'notify-deal-closed';

let ds: DataSource;
let tenantTx: TenantTransactionService;
let idem: IdempotentConsumer;
let notifications: NotificationsService;
let enqueued: Array<{ to: string }>;
let consumer: NotificationsConsumer;
let failingConsumer: NotificationsConsumer;

const deal = (tenantId: string, assignedTo: string | null, overrides: Record<string, unknown> = {}): BaseEvent => ({
  id: randomUUID(),
  type: EVENT_TYPES.CRM_DEAL_CLOSED,
  tenantId,
  occurredAt: '2026-06-11T00:00:00Z',
  payload: { dealId: randomUUID(), title: 'Big Deal', clientId: randomUUID(), valueMinor: 1_000_000, currency: 'PKR', assignedTo, ...overrides },
});

const ecommerceOrder = (tenantId: string): BaseEvent => ({
  id: randomUUID(),
  type: EVENT_TYPES.ECOMMERCE_ORDER_PLACED,
  tenantId,
  occurredAt: '2026-06-18T00:00:00Z',
  payload: { orderId: randomUUID(), orderNo: 'ORD-000042', clientId: null, paymentMethod: 'CARD', totalMinor: 480_000, taxMinor: 0, shippingMinor: 30_000, cogsMinor: 120_000, currency: 'PKR', lineCount: 2 },
});

const countFor = async (tenant: string, userId: string) =>
  Number((await ds.query(`SELECT count(*)::int c FROM notification WHERE tenant_id=$1 AND user_id=$2`, [tenant, userId]))[0].c);

const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
  RequestContext.run({ requestId: 't', tenantId }, fn);

beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  ds = new DataSource({ type: 'postgres', url, synchronize: false, logging: false });
  await ds.initialize();
  tenantTx = new TenantTransactionService(ds);
  idem = new IdempotentConsumer(undefined as never, tenantTx, undefined as never);
  notifications = new NotificationsService(tenantTx);
  enqueued = [];
  // A working email queue (records enqueues) and a BROKEN one (rejects) — both must leave in-app intact.
  const okEmail = { enqueue: async (m: { to: string }) => { enqueued.push(m); } } as unknown as EmailQueueService;
  const brokenEmail = { enqueue: async () => { throw new Error('SMTP unreachable'); } } as unknown as EmailQueueService;
  const cfg = { get: () => false } as never; // config unused by onDealClosed
  consumer = new NotificationsConsumer(undefined as never, cfg, notifications, okEmail);
  failingConsumer = new NotificationsConsumer(undefined as never, cfg, notifications, brokenEmail);
});

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  for (const t of [TA, TB]) {
    await ds.query(`DELETE FROM notification WHERE tenant_id=$1`, [t]);
    await ds.query(`DELETE FROM processed_event WHERE tenant_id=$1`, [t]);
    await ds.query(`DELETE FROM users WHERE tenant_id=$1 AND email LIKE 'rep-%@store.test'`, [t]);
  }
});

describe('notifications: deal_closed → in-app', () => {
  it('creates exactly one notification for the assignee, idempotent under redelivery', async () => {
    const userId = randomUUID();
    const e = deal(TA, userId);
    expect(await idem.handleOnce(CONSUMER, e, (ev, m) => consumer.onDealClosed(ev, m))).toBe('processed');
    expect(await idem.handleOnce(CONSUMER, e, (ev, m) => consumer.onDealClosed(ev, m))).toBe('duplicate'); // redelivery
    expect(await countFor(TA, userId)).toBe(1);
    const row = (await ds.query(`SELECT type, title FROM notification WHERE tenant_id=$1 AND user_id=$2`, [TA, userId]))[0];
    expect(row.type).toBe('crm.deal_won');
    expect(row.title).toBe('Deal won: Big Deal');
  });

  it('unassigned deal produces no notification', async () => {
    const e = deal(TA, null);
    expect(await idem.handleOnce(CONSUMER, e, (ev, m) => consumer.onDealClosed(ev, m))).toBe('processed');
    const total = Number((await ds.query(`SELECT count(*)::int c FROM notification WHERE tenant_id=$1`, [TA]))[0].c);
    expect(total).toBe(0);
  });

  it('still creates the in-app notification when the email side-channel is down (graceful)', async () => {
    const userId = randomUUID();
    const e = deal(TA, userId);
    // The broken email queue rejects, but the in-app row must commit anyway.
    expect(await idem.handleOnce(CONSUMER, e, (ev, m) => failingConsumer.onDealClosed(ev, m))).toBe('processed');
    expect(await countFor(TA, userId)).toBe(1);
  });

  it('is tenant-correct: a notification lands only under the event tenant', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await idem.handleOnce(CONSUMER, deal(TA, userA), (ev, m) => consumer.onDealClosed(ev, m));
    await idem.handleOnce(CONSUMER, deal(TB, userB), (ev, m) => consumer.onDealClosed(ev, m));
    expect(await countFor(TA, userA)).toBe(1);
    expect(await countFor(TB, userB)).toBe(1);
    expect(await countFor(TA, userB)).toBe(0);
  });
});

describe('notifications: ecommerce order → in-app', () => {
  it('fans a new-order notification out to store managers (sales rep), idempotent under redelivery', async () => {
    const rep = randomUUID();
    // An active SALES_REP in the tenant so role resolution finds a recipient.
    await ds.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, is_active, roles) VALUES ($1,$2,$3,'x',true,'{SALES_REP}')`,
      [rep, TA, `rep-${rep}@store.test`],
    );
    const e = ecommerceOrder(TA);
    const C = 'notify-ecommerce-order';
    expect(await idem.handleOnce(C, e, (ev, m) => consumer.onEcommerceOrder(ev, m))).toBe('processed');
    expect(await idem.handleOnce(C, e, (ev, m) => consumer.onEcommerceOrder(ev, m))).toBe('duplicate'); // redelivery
    expect(await countFor(TA, rep)).toBe(1);
    const row = (await ds.query(`SELECT type, category, title FROM notification WHERE tenant_id=$1 AND user_id=$2`, [TA, rep]))[0];
    expect(row.type).toBe('ecommerce.order_placed');
    expect(row.category).toBe('ecommerce');
    expect(row.title).toBe('New online order: ORD-000042');
  });
});

describe('notifications: read API', () => {
  it('listUnread returns unread, markRead removes from the feed (tenant-scoped)', async () => {
    const userId = randomUUID();
    await idem.handleOnce(CONSUMER, deal(TA, userId), (ev, m) => consumer.onDealClosed(ev, m));

    const unread = await inTenant(TA, () => notifications.listUnread(userId));
    expect(unread).toHaveLength(1);
    const id = unread[0].id as string;

    const marked = await inTenant(TA, () => notifications.markRead(id, userId));
    expect(marked.read).toBe(true);

    const after = await inTenant(TA, () => notifications.listUnread(userId));
    expect(after).toHaveLength(0);
  });

  it('markRead on another user\'s notification 404s', async () => {
    const owner = randomUUID();
    await idem.handleOnce(CONSUMER, deal(TA, owner), (ev, m) => consumer.onDealClosed(ev, m));
    const id = ((await ds.query(`SELECT id FROM notification WHERE tenant_id=$1 AND user_id=$2`, [TA, owner]))[0]).id as string;
    await expect(inTenant(TA, () => notifications.markRead(id, randomUUID()))).rejects.toThrow();
  });
});
