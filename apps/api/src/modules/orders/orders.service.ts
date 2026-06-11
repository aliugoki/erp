import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type { CreateOrderDto } from './dto/orders.dto';

type Step = 'reserve' | 'invoice' | 'pay';

/** A step failure that carries which step failed, so compensation + the saga record can record it. */
class StepError extends Error {
  constructor(
    readonly step: Step,
    message: string,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

export interface OrderRow {
  id: string;
  product_id: string;
  quantity: number;
  unit_price_minor: string;
  currency: string;
  status: string;
  reservation_id: string | null;
  invoice_id: string | null;
  failure_step: string | null;
  failure_reason: string | null;
}

const ORDER_COLS =
  'id, product_id, quantity, unit_price_minor, currency, status, reservation_id, invoice_id, failure_step, failure_reason';

/**
 * Order-to-cash saga orchestrator (Chunk 7.3). Each step runs in its OWN transaction and commits
 * independently; on any failure the orchestrator runs compensations for the steps that DID complete
 * (void the invoice, release the reservation), so the system never ends with an orphaned invoice or a
 * dangling stock hold. Steps are idempotent (re-entry reuses existing reservation/invoice). Terminal
 * outcomes are emitted to the transactional outbox (`orders.*`).
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<OrderRow> {
    const order = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO sales_order (tenant_id, product_id, quantity, unit_price_minor, currency, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, 'PENDING')
         RETURNING ${ORDER_COLS}`,
        [dto.productId, dto.quantity, dto.unitPriceMinor, dto.currency ?? 'PKR'],
      )) as OrderRow[];
      return rows[0]!;
    });

    const completed: Step[] = [];
    try {
      if (dto.failAt === 'reserve') throw new StepError('reserve', 'injected failure at reserve');
      const reservationId = await this.reserveStock(order);
      completed.push('reserve');
      await this.setOrder(order.id, { status: 'RESERVED', reservation_id: reservationId });

      if (dto.failAt === 'invoice') throw new StepError('invoice', 'injected failure at invoice');
      const invoiceId = await this.createInvoice(order);
      completed.push('invoice');
      await this.setOrder(order.id, { status: 'INVOICED', invoice_id: invoiceId });

      if (dto.failAt === 'pay') throw new StepError('pay', 'injected failure at pay');
      await this.commit(order.id);
      this.logger.log(`order ${order.id} completed (paid)`);
      return await this.getOrder(order.id);
    } catch (err) {
      const step = err instanceof StepError ? err.step : 'reserve';
      this.logger.warn(`order ${order.id} failed at ${step}: ${(err as Error).message}; compensating`);
      await this.compensate(order.id, completed, step, (err as Error).message);
      return await this.getOrder(order.id);
    }
  }

  async getOrder(id: string): Promise<OrderRow> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${ORDER_COLS} FROM sales_order WHERE id=$1`, [id])) as OrderRow[];
      if (!rows[0]) throw new NotFoundException('Order not found');
      return rows[0];
    });
  }

  // ── Steps (each its own transaction, each idempotent) ─────────────────────

  /** Reserve stock: hold the quantity (checks availability). Reuses an existing HELD reservation. */
  private reserveStock(order: OrderRow): Promise<string> {
    return this.tenantTx.run(async (m: EntityManager) => {
      const existing = (await m.query(
        `SELECT id FROM inventory_reservation WHERE order_id=$1 AND status='HELD'`,
        [order.id],
      )) as Array<{ id: string }>;
      if (existing[0]) return existing[0].id;

      const prod = (await m.query(`SELECT on_hand FROM inventory_product WHERE id=$1 FOR UPDATE`, [
        order.product_id,
      ])) as Array<{ on_hand: number }>;
      if (!prod[0]) throw new StepError('reserve', 'unknown product');
      if (prod[0].on_hand < order.quantity) throw new StepError('reserve', 'insufficient stock');

      const rows = (await m.query(
        `INSERT INTO inventory_reservation (tenant_id, order_id, product_id, quantity, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, 'HELD') RETURNING id`,
        [order.id, order.product_id, order.quantity],
      )) as Array<{ id: string }>;
      return rows[0]!.id;
    });
  }

  /** Create the invoice (SENT). Reuses the order's invoice if one already exists. */
  private createInvoice(order: OrderRow): Promise<string> {
    return this.tenantTx.run(async (m) => {
      const current = (await m.query(`SELECT invoice_id FROM sales_order WHERE id=$1`, [order.id])) as Array<{
        invoice_id: string | null;
      }>;
      if (current[0]?.invoice_id) return current[0].invoice_id;

      const total = order.quantity * Number(order.unit_price_minor);
      const lineItems = JSON.stringify([
        { description: 'Sales order', quantity: order.quantity, unitPriceMinor: Number(order.unit_price_minor) },
      ]);
      const rows = (await m.query(
        `INSERT INTO finance_invoice (tenant_id, number, line_items, subtotal_minor, tax_minor, total_minor, currency, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2::jsonb, $3, 0, $3, $4, 'SENT') RETURNING id`,
        [`SO-${order.id.slice(0, 8)}`, lineItems, total, order.currency],
      )) as Array<{ id: string }>;
      return rows[0]!.id;
    });
  }

  /** Commit: invoice PAID, reservation CONSUMED, stock decremented, order PAID — atomically. */
  private commit(orderId: string): Promise<void> {
    return this.tenantTx.run(async (m) => {
      const o = (await this.lock(m, orderId));
      await m.query(`UPDATE finance_invoice SET status='PAID', paid_at=now(), updated_at=now() WHERE id=$1`, [o.invoice_id]);
      await m.query(`UPDATE inventory_reservation SET status='CONSUMED', updated_at=now() WHERE id=$1`, [o.reservation_id]);
      // CHECK (on_hand >= 0) guards against committing an oversell.
      await m.query(`UPDATE inventory_product SET on_hand = on_hand - $2, updated_at=now() WHERE id=$1`, [o.product_id, o.quantity]);
      await m.query(`UPDATE sales_order SET status='PAID', updated_at=now() WHERE id=$1`, [orderId]);
      await this.outbox.write(m, 'orders.order_completed.v1', { orderId, invoiceId: o.invoice_id });
    });
  }

  /** Compensate the steps that completed, in reverse, then mark the saga COMPENSATED. */
  private compensate(orderId: string, completed: Step[], step: Step, reason: string): Promise<void> {
    return this.tenantTx.run(async (m) => {
      const o = await this.lock(m, orderId);
      if (completed.includes('invoice') && o.invoice_id) {
        await m.query(`UPDATE finance_invoice SET status='VOID', updated_at=now() WHERE id=$1`, [o.invoice_id]);
      }
      if (completed.includes('reserve') && o.reservation_id) {
        await m.query(`UPDATE inventory_reservation SET status='RELEASED', updated_at=now() WHERE id=$1`, [o.reservation_id]);
      }
      await m.query(
        `UPDATE sales_order SET status='COMPENSATED', failure_step=$2, failure_reason=$3, updated_at=now() WHERE id=$1`,
        [orderId, step, reason],
      );
      await this.outbox.write(m, 'orders.order_compensated.v1', { orderId, step });
    });
  }

  private async lock(m: EntityManager, orderId: string): Promise<OrderRow> {
    const rows = (await m.query(`SELECT ${ORDER_COLS} FROM sales_order WHERE id=$1 FOR UPDATE`, [orderId])) as OrderRow[];
    if (!rows[0]) throw new BadRequestException('Order vanished mid-saga');
    return rows[0];
  }

  private setOrder(id: string, patch: { status: string; reservation_id?: string; invoice_id?: string }): Promise<void> {
    return this.tenantTx.run(async (m) => {
      await m.query(
        `UPDATE sales_order SET status=$2, reservation_id=COALESCE($3, reservation_id), invoice_id=COALESCE($4, invoice_id), updated_at=now() WHERE id=$1`,
        [id, patch.status, patch.reservation_id ?? null, patch.invoice_id ?? null],
      );
    });
  }
}
