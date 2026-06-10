import type { EntityManager } from 'typeorm';
import type {
  BaseEvent,
  CrmDealClosedV1,
  FinanceInvoicePaidV1,
  InventoryLowStockV1,
} from '@metaxperts/shared';

/** Commission rate applied to closed-won deals (basis points: 500 = 5%). */
export const COMMISSION_RATE_BPS = 500;

/**
 * Event reaction handlers (Chunk 4.4). Each runs inside the consumer's idempotent tenant transaction
 * (the `tenant_id` is set on the connection), so it writes its effect exactly once per event. Pure
 * SQL — no surrounding framework — which makes them trivially unit-testable.
 */

/** inventory.low_stock → suggest a purchase order to restock to the reorder point. */
export async function handleLowStock(event: BaseEvent, m: EntityManager): Promise<void> {
  const p = event.payload as InventoryLowStockV1;
  const suggestedQty = Math.max(1, p.minStock - p.onHand);
  await m.query(
    `INSERT INTO po_suggestion (tenant_id, product_id, suggested_qty, source_event_id)
     VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)`,
    [p.productId, suggestedQty, event.id],
  );
}

/** finance.invoice_paid → add to the tenant's running received balance (upsert, integer minor units). */
export async function handleInvoicePaid(event: BaseEvent, m: EntityManager): Promise<void> {
  const p = event.payload as FinanceInvoicePaidV1;
  await m.query(
    `INSERT INTO finance_balance (tenant_id, currency, total_received_minor)
     VALUES (current_setting('app.tenant_id')::uuid, $1, $2)
     ON CONFLICT (tenant_id, currency)
     DO UPDATE SET total_received_minor = finance_balance.total_received_minor + EXCLUDED.total_received_minor,
                   updated_at = now()`,
    [p.currency, p.totalMinor],
  );
}

/** crm.deal_closed → compute and record the sales commission. */
export async function handleDealClosed(event: BaseEvent, m: EntityManager): Promise<void> {
  const p = event.payload as CrmDealClosedV1;
  const amountMinor = Math.floor((p.valueMinor * COMMISSION_RATE_BPS) / 10000);
  await m.query(
    `INSERT INTO commission (tenant_id, deal_id, amount_minor, currency, rate_bps, source_event_id)
     VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5)`,
    [p.dealId, amountMinor, p.currency, COMMISSION_RATE_BPS, event.id],
  );
}
