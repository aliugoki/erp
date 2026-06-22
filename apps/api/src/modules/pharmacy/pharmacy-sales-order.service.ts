import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateSalesOrderDto, FulfillSalesOrderDto } from './dto/pharmacy.dto';
import { PharmacyDispenseService } from './pharmacy-dispense.service';
import { DOC_PREFIX, type Row, formatDocNo, money } from './pharmacy.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Wholesale (B2B) sales orders: a customer order is confirmed then fulfilled. Fulfilment rings a
 * WHOLESALE dispense for the outstanding lines (FEFO + GL via the shared dispense path); the order's
 * agreed line price is used when set, otherwise the dispense resolves a quantity-break price tier.
 */
@Injectable()
export class PharmacySalesOrderService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly dispense: PharmacyDispenseService,
  ) {}

  private async nextDocNo(m: Mgr): Promise<string> {
    const seq = (await m.query(
      `INSERT INTO pharmacy_doc_seq (tenant_id, doc_type, last_no) VALUES (current_setting('app.tenant_id')::uuid, 'SO', 1)
       ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = pharmacy_doc_seq.last_no + 1 RETURNING last_no`,
    )) as Array<{ last_no: string }>;
    return formatDocNo(DOC_PREFIX.SO, Number(seq[0]!.last_no));
  }

  async create(dto: CreateSalesOrderDto) {
    const currency = dto.currency ?? 'PKR';
    return this.tenantTx.run(async (m) => {
      const orderNo = await this.nextDocNo(m);
      const total = dto.items.reduce((s, i) => s + i.qty * (i.unitPriceMinor ?? 0), 0);
      let header: Row;
      try {
        const rows = (await m.query(
          `INSERT INTO pharmacy_sales_order (tenant_id, order_no, customer_id, status, currency, total_minor, expected_on, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,'DRAFT',$3,$4,$5,$6)
           RETURNING id, order_no, status`,
          [orderNo, dto.customerId ?? null, currency, total, dto.expectedOn ?? null, dto.notes ?? null],
        )) as Row[];
        header = rows[0]!;
      } catch (err) {
        if ((err as { code?: string })?.code === '23503') throw new BadRequestException('Unknown customer for this tenant');
        throw err;
      }
      for (const i of dto.items) {
        try {
          await m.query(
            `INSERT INTO pharmacy_sales_order_item (tenant_id, order_id, product_id, qty, unit_price_minor)
             VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)`,
            [header.id, i.productId, i.qty, i.unitPriceMinor ?? 0],
          );
        } catch (err) {
          if ((err as { code?: string })?.code === '23503') throw new BadRequestException('One or more products do not exist in this tenant');
          throw err;
        }
      }
      return { id: header.id, orderNo: header.order_no, status: header.status, total: money(total, currency), items: dto.items.length };
    });
  }

  async setStatus(id: string, to: 'CONFIRMED' | 'CANCELLED') {
    const allowed: Record<string, string[]> = { CONFIRMED: ['DRAFT'], CANCELLED: ['DRAFT', 'CONFIRMED', 'PARTIAL'] };
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status FROM pharmacy_sales_order WHERE id=$1 AND deleted_at IS NULL`, [id])) as Array<{ status: string }>;
      if (!cur[0]) throw new NotFoundException('Sales order not found');
      if (!(allowed[to] ?? []).includes(cur[0].status)) throw new UnprocessableEntityException(`Cannot move a ${cur[0].status} order to ${to}`);
      await m.query(`UPDATE pharmacy_sales_order SET status=$1, updated_at=now() WHERE id=$2`, [to, id]);
      return { id, status: to };
    });
  }

  /** Fulfil a confirmed order: ring a WHOLESALE dispense for the outstanding lines + advance status. */
  async fulfill(id: string, dto: FulfillSalesOrderDto) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(`SELECT id, order_no, customer_id, status FROM pharmacy_sales_order WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      if (!h[0]) throw new NotFoundException('Sales order not found');
      if (!['CONFIRMED', 'PARTIAL'].includes(h[0].status as string)) throw new UnprocessableEntityException('Order must be CONFIRMED before fulfilment');
      const items = (await m.query(`SELECT id, product_id, qty, fulfilled_qty, unit_price_minor FROM pharmacy_sales_order_item WHERE order_id=$1`, [id])) as Row[];
      const lines = items
        .map((r) => ({ itemId: r.id as string, productId: r.product_id as string, qty: Number(r.qty) - Number(r.fulfilled_qty), unitPriceMinor: Number(r.unit_price_minor) }))
        .filter((l) => l.qty > 0);
      if (lines.length === 0) throw new UnprocessableEntityException('Nothing outstanding to fulfil');

      const result = await this.dispense.createDispenseInTx(m, {
        type: 'WHOLESALE',
        paymentMethod: 'CREDIT',
        ...(h[0].customer_id ? { customerId: h[0].customer_id as string } : {}),
        ...(dto.notes ? { notes: dto.notes } : {}),
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(l.unitPriceMinor > 0 ? { unitPriceMinor: l.unitPriceMinor } : {}) })),
      });

      for (const l of lines) {
        await m.query(`UPDATE pharmacy_sales_order_item SET fulfilled_qty = fulfilled_qty + $1, updated_at=now() WHERE id=$2`, [l.qty, l.itemId]);
      }
      const agg = (await m.query(`SELECT COALESCE(SUM(qty),0)::int AS q, COALESCE(SUM(fulfilled_qty),0)::int AS f FROM pharmacy_sales_order_item WHERE order_id=$1`, [id])) as Array<{ q: number; f: number }>;
      const status = agg[0]!.f >= agg[0]!.q ? 'FULFILLED' : 'PARTIAL';
      await m.query(`UPDATE pharmacy_sales_order SET status=$1, updated_at=now() WHERE id=$2`, [status, id]);
      return { id, orderNo: h[0].order_no, status, dispense: result };
    });
  }

  async list(status?: string) {
    return this.tenantTx.run((m) => {
      const conds = ['o.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (status) conds.push(`o.status = $${params.push(status)}`);
      return m.query(
        `SELECT o.id, o.order_no, o.status, o.currency, o.total_minor, o.expected_on::text AS expected_on,
                c.name AS customer, count(i.id)::int AS item_count
         FROM pharmacy_sales_order o LEFT JOIN customer c ON c.id = o.customer_id
         LEFT JOIN pharmacy_sales_order_item i ON i.order_id = o.id
         WHERE ${conds.join(' AND ')} GROUP BY o.id, c.name ORDER BY o.created_at DESC`,
        params,
      );
    });
  }

  async get(id: string) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(
        `SELECT o.id, o.order_no, o.status, o.currency, o.total_minor, o.expected_on::text AS expected_on, o.notes, c.name AS customer
         FROM pharmacy_sales_order o LEFT JOIN customer c ON c.id = o.customer_id WHERE o.id=$1 AND o.deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!h[0]) throw new NotFoundException('Sales order not found');
      const items = (await m.query(
        `SELECT i.id, i.product_id, p.sku, p.name, i.qty, i.fulfilled_qty, i.unit_price_minor
         FROM pharmacy_sales_order_item i JOIN inventory_product p ON p.id = i.product_id WHERE i.order_id=$1 ORDER BY i.created_at`,
        [id],
      )) as Row[];
      const r = h[0];
      const cur = r.currency as string;
      return {
        id: r.id, orderNo: r.order_no, status: r.status, currency: cur, expectedOn: r.expected_on ?? null,
        notes: r.notes ?? null, customer: r.customer ?? null, total: money(r.total_minor, cur),
        items: items.map((i) => ({ id: i.id, productId: i.product_id, sku: i.sku, name: i.name, qty: Number(i.qty), fulfilledQty: Number(i.fulfilled_qty), unitPrice: money(i.unit_price_minor, cur) })),
      };
    });
  }
}
