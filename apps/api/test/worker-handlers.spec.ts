/**
 * Worker reaction handlers test (Chunk 4.4 gate). Each handler is idempotent (same event twice →
 * effect once) and tenant-correct (effects land under the event's tenant). Driven through
 * IdempotentConsumer.handleOnce against the real DB.
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
import { handleDealClosed, handleInvoicePaid, handleLowStock } from '../src/modules/reactions/handlers';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../.env')]) {
  if (existsSync(c)) { loadDotenv({ path: c }); break; }
}

const TA = 'aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TB = 'bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
let ds: DataSource;
let consumer: IdempotentConsumer;

const evt = (type: string, tenantId: string, payload: unknown): BaseEvent => ({
  id: randomUUID(), type, tenantId, occurredAt: '2026-06-10T00:00:00Z', payload,
});
const count = async (table: string, tenant: string) =>
  Number((await ds.query(`SELECT count(*)::int c FROM ${table} WHERE tenant_id=$1`, [tenant]))[0].c);

beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  ds = new DataSource({ type: 'postgres', url, synchronize: false, logging: false });
  await ds.initialize();
  consumer = new IdempotentConsumer(undefined as never, new TenantTransactionService(ds), undefined as never);
});
afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});
beforeEach(async () => {
  for (const t of [TA, TB]) {
    for (const tbl of ['po_suggestion', 'finance_balance', 'commission', 'processed_event']) {
      await ds.query(`DELETE FROM ${tbl} WHERE tenant_id=$1`, [t]);
    }
  }
});

describe('reaction handlers', () => {
  it('low_stock → one PO suggestion (idempotent under redelivery)', async () => {
    const e = evt(EVENT_TYPES.INVENTORY_LOW_STOCK, TA, { productId: randomUUID(), onHand: 7, minStock: 10 });
    expect(await consumer.handleOnce('worker-inventory', e, handleLowStock)).toBe('processed');
    expect(await consumer.handleOnce('worker-inventory', e, handleLowStock)).toBe('duplicate');
    expect(await count('po_suggestion', TA)).toBe(1);
    const row = (await ds.query(`SELECT suggested_qty FROM po_suggestion WHERE tenant_id=$1`, [TA]))[0];
    expect(row.suggested_qty).toBe(3); // minStock - onHand
  });

  it('invoice_paid → balance incremented exactly once', async () => {
    const e = evt(EVENT_TYPES.FINANCE_INVOICE_PAID, TA, { invoiceId: 'i', number: 'INV', clientId: null, totalMinor: 170000, currency: 'PKR' });
    await consumer.handleOnce('worker-finance', e, handleInvoicePaid);
    await consumer.handleOnce('worker-finance', e, handleInvoicePaid); // redelivery
    const bal = (await ds.query(`SELECT total_received_minor::bigint b FROM finance_balance WHERE tenant_id=$1 AND currency='PKR'`, [TA]))[0];
    expect(Number(bal.b)).toBe(170000); // not doubled
  });

  it('deal_closed → one commission at 5%', async () => {
    const e = evt(EVENT_TYPES.CRM_DEAL_CLOSED, TA, { dealId: randomUUID(), title: 'X', clientId: 'c', valueMinor: 1000000, currency: 'PKR' });
    await consumer.handleOnce('worker-crm', e, handleDealClosed);
    await consumer.handleOnce('worker-crm', e, handleDealClosed);
    expect(await count('commission', TA)).toBe(1);
    const row = (await ds.query(`SELECT amount_minor::bigint a FROM commission WHERE tenant_id=$1`, [TA]))[0];
    expect(Number(row.a)).toBe(50000); // 5% of 1,000,000
  });

  it('is tenant-correct: each tenant gets its own effect', async () => {
    await consumer.handleOnce('worker-inventory', evt(EVENT_TYPES.INVENTORY_LOW_STOCK, TA, { productId: randomUUID(), onHand: 1, minStock: 5 }), handleLowStock);
    await consumer.handleOnce('worker-inventory', evt(EVENT_TYPES.INVENTORY_LOW_STOCK, TB, { productId: randomUUID(), onHand: 2, minStock: 9 }), handleLowStock);
    expect(await count('po_suggestion', TA)).toBe(1);
    expect(await count('po_suggestion', TB)).toBe(1);
    const a = (await ds.query(`SELECT suggested_qty FROM po_suggestion WHERE tenant_id=$1`, [TA]))[0];
    const b = (await ds.query(`SELECT suggested_qty FROM po_suggestion WHERE tenant_id=$1`, [TB]))[0];
    expect(a.suggested_qty).toBe(4); // 5 - 1
    expect(b.suggested_qty).toBe(7); // 9 - 2
  });
});
