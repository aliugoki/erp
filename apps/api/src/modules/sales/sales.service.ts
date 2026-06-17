import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateOrderDto, CreateQuotationDto } from './dto/sales.dto';
import {
  type LineInput,
  computeTotals,
  lineTotalMinor,
  mapLine,
  mapOrder,
  mapQuotation,
  nextSalesDocNo,
} from './sales.util';

type Row = Record<string, unknown>;
const Q_COLS = 'id, quote_no, client_id, deal_id, status, currency, valid_until, tax_rate, subtotal_minor, tax_minor, total_minor, notes';
const O_COLS = 'id, so_no, client_id, quotation_id, status, currency, order_date, expected_date, total_minor, notes';

/** Sales — quote-to-order. Quotations carry priced lines + tax; an accepted quotation converts to a
 * sales order whose lines track delivered quantity. Raw SQL via the tenant-scoped tx (RLS); money is
 * integer minor units. */
@Injectable()
export class SalesService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  // ── Quotations ────────────────────────────────────────────────────────────────
  async createQuotation(dto: CreateQuotationDto) {
    const taxRate = dto.taxRate ?? 0;
    const totals = computeTotals(dto.lines as LineInput[], taxRate);
    return this.tenantTx.run(async (m) => {
      const quoteNo = await nextSalesDocNo(m, 'QUO', 'QUO');
      let quotationId: string;
      try {
        const rows = (await m.query(
          `INSERT INTO sales_quotation
             (tenant_id, quote_no, client_id, deal_id, valid_until, tax_rate, subtotal_minor, tax_minor, total_minor, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [quoteNo, dto.clientId, dto.dealId ?? null, dto.validUntil ?? null, taxRate, totals.subtotalMinor, totals.taxMinor, totals.totalMinor, dto.notes ?? null],
        )) as Row[];
        quotationId = rows[0]!.id as string;
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown account for this tenant');
        throw err;
      }
      await this.insertLines(m, 'sales_quotation_line', 'quotation_id', quotationId, dto.lines as LineInput[]);
      return this.getQuotationWith(m, quotationId);
    });
  }

  async listQuotations() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${Q_COLS} FROM sales_quotation WHERE deleted_at IS NULL ORDER BY created_at DESC`)) as Row[];
      return rows.map(mapQuotation);
    });
  }

  async getQuotation(id: string) {
    return this.tenantTx.run((m) => this.getQuotationWith(m, id));
  }

  async setQuotationStatus(id: string, status: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE sales_quotation SET status=$2, updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL AND status NOT IN ('CONVERTED') RETURNING id`,
        [id, status],
      )) as unknown;
      if (rowsOf(rows).length === 0) throw new NotFoundException('Quotation not found or already converted');
      return this.getQuotationWith(m, id);
    });
  }

  /** Convert an accepted quotation into a confirmed sales order (copies lines), marking it CONVERTED. */
  async convertToOrder(id: string) {
    return this.tenantTx.run(async (m) => {
      const qRows = (await m.query(`SELECT ${Q_COLS} FROM sales_quotation WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
      const quote = qRows[0];
      if (!quote) throw new NotFoundException('Quotation not found');
      if (quote.status === 'CONVERTED') throw new BadRequestException('Quotation already converted');

      const lines = (await m.query(
        `SELECT product_id, description, quantity, unit_price_minor, line_total_minor
         FROM sales_quotation_line WHERE quotation_id=$1 AND deleted_at IS NULL ORDER BY created_at`,
        [id],
      )) as Row[];

      const soNo = await nextSalesDocNo(m, 'SO', 'SO');
      const oRows = (await m.query(
        `INSERT INTO sales_so (tenant_id, so_no, client_id, quotation_id, status, currency, total_minor, notes)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,'CONFIRMED',$4,$5,$6) RETURNING id`,
        [soNo, quote.client_id, id, quote.currency, quote.total_minor, quote.notes ?? null],
      )) as Row[];
      const orderId = oRows[0]!.id as string;
      for (const l of lines) {
        await m.query(
          `INSERT INTO sales_so_line (tenant_id, order_id, product_id, description, quantity, unit_price_minor, line_total_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6)`,
          [orderId, l.product_id ?? null, l.description, l.quantity, l.unit_price_minor, l.line_total_minor],
        );
      }
      await m.query(`UPDATE sales_quotation SET status='CONVERTED', updated_at=now() WHERE id=$1`, [id]);
      return this.getOrderWith(m, orderId);
    });
  }

  // ── Sales orders ────────────────────────────────────────────────────────────
  async createOrder(dto: CreateOrderDto) {
    const totals = computeTotals(dto.lines as LineInput[], 0);
    return this.tenantTx.run(async (m) => {
      const soNo = await nextSalesDocNo(m, 'SO', 'SO');
      let orderId: string;
      try {
        const rows = (await m.query(
          `INSERT INTO sales_so (tenant_id, so_no, client_id, status, expected_date, total_minor, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,'CONFIRMED',$3,$4,$5) RETURNING id`,
          [soNo, dto.clientId, dto.expectedDate ?? null, totals.totalMinor, dto.notes ?? null],
        )) as Row[];
        orderId = rows[0]!.id as string;
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown account for this tenant');
        throw err;
      }
      await this.insertLines(m, 'sales_so_line', 'order_id', orderId, dto.lines as LineInput[]);
      return this.getOrderWith(m, orderId);
    });
  }

  async listOrders() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${O_COLS} FROM sales_so WHERE deleted_at IS NULL ORDER BY created_at DESC`)) as Row[];
      return rows.map(mapOrder);
    });
  }

  async getOrder(id: string) {
    return this.tenantTx.run((m) => this.getOrderWith(m, id));
  }

  /** Mark an order fully delivered (sets every line delivered_qty = quantity, status DELIVERED). */
  async fulfillOrder(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT id, status FROM sales_so WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
      const order = rows[0];
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === 'CANCELLED') throw new BadRequestException('Order is cancelled');
      await m.query(`UPDATE sales_so_line SET delivered_qty = quantity, updated_at=now() WHERE order_id=$1`, [id]);
      await m.query(`UPDATE sales_so SET status='DELIVERED', updated_at=now() WHERE id=$1`, [id]);
      return this.getOrderWith(m, id);
    });
  }

  async cancelOrder(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE sales_so SET status='CANCELLED', updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL AND status NOT IN ('DELIVERED','INVOICED') RETURNING id`,
        [id],
      )) as unknown;
      if (rowsOf(rows).length === 0) throw new NotFoundException('Order not found or not cancellable');
      return this.getOrderWith(m, id);
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  private async insertLines(m: EntityManager, table: string, fk: string, parentId: string, lines: LineInput[]) {
    for (const l of lines) {
      await m.query(
        `INSERT INTO ${table} (tenant_id, ${fk}, product_id, description, quantity, unit_price_minor, line_total_minor)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6)`,
        [parentId, l.productId ?? null, l.description, l.quantity, l.unitPriceMinor, lineTotalMinor(l.quantity, l.unitPriceMinor)],
      );
    }
  }

  private async getQuotationWith(m: EntityManager, id: string) {
    const rows = (await m.query(`SELECT ${Q_COLS} FROM sales_quotation WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Quotation not found');
    const lines = (await m.query(
      `SELECT id, product_id, description, quantity, unit_price_minor, line_total_minor
       FROM sales_quotation_line WHERE quotation_id=$1 AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    )) as Row[];
    const currency = rows[0].currency;
    return { ...mapQuotation(rows[0]), lines: lines.map((l) => mapLine(l, currency)) };
  }

  private async getOrderWith(m: EntityManager, id: string) {
    const rows = (await m.query(`SELECT ${O_COLS} FROM sales_so WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Order not found');
    const lines = (await m.query(
      `SELECT id, product_id, description, quantity, delivered_qty, unit_price_minor, line_total_minor
       FROM sales_so_line WHERE order_id=$1 AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    )) as Row[];
    const currency = rows[0].currency;
    return { ...mapOrder(rows[0]), lines: lines.map((l) => mapLine(l, currency)) };
  }
}

/** TypeORM returns [rows, affectedCount] for UPDATE…RETURNING; normalize to the rows array. */
function rowsOf(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return (res ?? []) as unknown[];
}
const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
