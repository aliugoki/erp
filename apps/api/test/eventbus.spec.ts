/**
 * EventBus integration test (Chunk 4.2 gate). Publishes each versioned contract through the RabbitMQ
 * EventBus and asserts a subscriber receives the typed payload. Also a compile-time check that a
 * mismatched payload fails typecheck. Requires RabbitMQ (infra) up.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CrmDealClosedV1,
  type DomainEvent,
  EVENT_TYPES,
  type FinanceInvoicePaidV1,
  type InventoryLowStockV1,
} from '@metaxperts/shared';
import { EventBusService } from '../src/modules/eventbus/event-bus.service';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../.env')]) {
  if (existsSync(c)) { loadDotenv({ path: c }); break; }
}

let bus: EventBusService;

function fakeConfig() {
  return { get: () => process.env.RABBITMQ_URL ?? 'amqp://metaxperts:metaxperts@127.0.0.1:5672' } as never;
}

/** Subscribe to a one-shot ephemeral queue and resolve with the next event. */
function nextEvent(type: string, timeoutMs = 5000): Promise<DomainEvent> {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => reject(new Error(`no event for ${type} within ${timeoutMs}ms`)), timeoutMs);
    void bus.subscribe(
      type,
      (event) => {
        clearTimeout(timer);
        resolveEvent(event as DomainEvent);
      },
      { queue: `test.${type}.${randomUUID()}`, durable: false, autoDelete: true, exclusive: true },
    );
  });
}

beforeAll(async () => {
  bus = new EventBusService(fakeConfig());
  await bus.connect();
});
afterAll(async () => {
  if (bus) await bus.close();
});

describe('EventBus (RabbitMQ)', () => {
  it('round-trips finance.invoice_paid.v1 with its typed payload', async () => {
    const got = nextEvent(EVENT_TYPES.FINANCE_INVOICE_PAID);
    await new Promise((r) => setTimeout(r, 200)); // let the consumer bind
    const payload: FinanceInvoicePaidV1 = { invoiceId: 'inv-1', number: 'INV-001', clientId: null, totalMinor: 170000, currency: 'PKR' };
    const event: DomainEvent<'finance.invoice_paid.v1'> = {
      id: randomUUID(), type: EVENT_TYPES.FINANCE_INVOICE_PAID, tenantId: 't1', occurredAt: '2026-06-10T00:00:00Z', payload,
    };
    await bus.publish(event);
    const received = await got;
    expect(received.type).toBe('finance.invoice_paid.v1');
    expect(received.payload).toEqual(payload);
  });

  it('round-trips inventory.low_stock.v1', async () => {
    const got = nextEvent(EVENT_TYPES.INVENTORY_LOW_STOCK);
    await new Promise((r) => setTimeout(r, 200));
    const payload: InventoryLowStockV1 = { productId: 'p1', onHand: 7, minStock: 10 };
    await bus.publish({ id: randomUUID(), type: EVENT_TYPES.INVENTORY_LOW_STOCK, tenantId: 't1', occurredAt: '2026-06-10T00:00:00Z', payload });
    expect((await got).payload).toEqual(payload);
  });

  it('round-trips crm.deal_closed.v1', async () => {
    const got = nextEvent(EVENT_TYPES.CRM_DEAL_CLOSED);
    await new Promise((r) => setTimeout(r, 200));
    const payload: CrmDealClosedV1 = { dealId: 'd1', title: 'Big', clientId: 'c1', valueMinor: 1000000, currency: 'PKR' };
    await bus.publish({ id: randomUUID(), type: EVENT_TYPES.CRM_DEAL_CLOSED, tenantId: 't1', occurredAt: '2026-06-10T00:00:00Z', payload });
    expect((await got).payload).toEqual(payload);
  });

  it('rejects a mismatched payload at compile time', () => {
    // @ts-expect-error finance.invoice_paid.v1 requires totalMinor:number, not a string
    const bad: DomainEvent<'finance.invoice_paid.v1'> = {
      id: 'x', type: 'finance.invoice_paid.v1', tenantId: 't', occurredAt: 'now',
      payload: { invoiceId: 'i', number: 'n', clientId: null, totalMinor: 'oops', currency: 'PKR' },
    };
    expect(bad.type).toBe('finance.invoice_paid.v1');
  });
});
