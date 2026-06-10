/**
 * Load test for the event reaction path (ADR-001 decision gate). Publishes N inventory.low_stock
 * events through the RabbitMQ EventBus, has the IdempotentConsumer (BullMQ/NestJS, in-process) handle
 * them into po_suggestion rows, and reports throughput. Usage: node load-reactions.cjs [N]
 */
const { resolve } = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: resolve(__dirname, '../../../.env') });
const { DataSource } = require('typeorm');
const { EventBusService } = require('../dist/modules/eventbus/event-bus.service');
const { IdempotentConsumer } = require('../dist/modules/consumers/idempotent-consumer.service');
const { DlqService } = require('../dist/modules/consumers/dlq.service');
const { TenantTransactionService } = require('../dist/common/tenant/tenant-transaction.service');
const { handleLowStock } = require('../dist/modules/reactions/handlers');

const TENANT = 'ffff0000-ffff-ffff-ffff-ffffffffffff';
const CONSUMER = 'load-inv';

(async () => {
  const N = parseInt(process.argv[2] || '10000', 10);
  const ds = new DataSource({ type: 'postgres', url: process.env.MIGRATION_DATABASE_URL, synchronize: false, logging: false, extra: { max: 20 } });
  await ds.initialize();
  const tenantTx = new TenantTransactionService(ds);
  const bus = new EventBusService({ get: () => process.env.RABBITMQ_URL });
  await bus.connect();
  const consumer = new IdempotentConsumer(bus, tenantTx, new DlqService(tenantTx, bus));
  await consumer.register({ eventType: 'inventory.low_stock.v1', consumer: CONSUMER, handler: handleLowStock, prefetch: 100 });

  const ch = await bus.getChannel();
  await ch.purgeQueue(`c.${CONSUMER}`).catch(() => undefined);
  await ds.query('DELETE FROM po_suggestion WHERE tenant_id=$1', [TENANT]);
  await ds.query('DELETE FROM processed_event WHERE tenant_id=$1 AND consumer=$2', [TENANT, CONSUMER]);

  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await bus.publish({
      id: crypto.randomUUID(), type: 'inventory.low_stock.v1', tenantId: TENANT,
      occurredAt: new Date().toISOString(), payload: { productId: crypto.randomUUID(), onHand: 1, minStock: 5 },
    });
  }
  const tPub = Date.now();

  let c = 0;
  const deadline = Date.now() + 120000;
  while (c < N && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    c = Number((await ds.query('SELECT count(*)::int c FROM po_suggestion WHERE tenant_id=$1', [TENANT]))[0].c);
  }
  const tDone = Date.now();

  const result = {
    events: N,
    processed: c,
    publishMs: tPub - t0,
    totalMs: tDone - t0,
    publishRatePerSec: Math.round(N / ((tPub - t0) / 1000)),
    endToEndRatePerSec: Math.round(c / ((tDone - t0) / 1000)),
  };
  console.log(JSON.stringify(result));
  await ds.query('DELETE FROM po_suggestion WHERE tenant_id=$1', [TENANT]).catch(() => undefined);
  await ds.query('DELETE FROM processed_event WHERE tenant_id=$1 AND consumer=$2', [TENANT, CONSUMER]).catch(() => undefined);
  await bus.close();
  await ds.destroy();
  process.exit(c >= N ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
