import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type { AdjustStockDto, ReturnToVendorDto, WriteOffDto, WriteOffExpiredDto } from './dto/pharmacy.dto';
import { PharmacyStockService } from './pharmacy-stock.service';
import { DOC_PREFIX, type Row, formatDocNo, money } from './pharmacy.util';
import type { AdjustmentForGl } from './pharmacy-gl.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
type AdjType = 'RTV' | 'WRITEOFF' | 'ADJUST';
interface AdjItem { lotId: string; qty: number; direction: 'IN' | 'OUT' }

/**
 * Non-sale stock movements that still need valuing + a GL posting: return-to-vendor (RTV), expiry
 * write-off, and manual cycle-count adjustment. Each item moves a specific lot through the shared
 * valued ledger; the header is emitted to the outbox (`pharmacy.stock_adjusted`) so the GL consumer
 * posts the voucher. `valueMinor` is signed: positive = inventory decreased.
 */
@Injectable()
export class PharmacyAdjustmentService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly stock: PharmacyStockService,
    private readonly outbox: OutboxService,
  ) {}

  private async nextDocNo(m: Mgr, docType: keyof typeof DOC_PREFIX): Promise<string> {
    const seq = (await m.query(
      `INSERT INTO pharmacy_doc_seq (tenant_id, doc_type, last_no)
       VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
       ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = pharmacy_doc_seq.last_no + 1
       RETURNING last_no`,
      [docType],
    )) as Array<{ last_no: string }>;
    return formatDocNo(DOC_PREFIX[docType], Number(seq[0]!.last_no));
  }

  async returnToVendor(dto: ReturnToVendorDto) {
    const items: AdjItem[] = dto.items.map((i) => ({ lotId: i.lotId, qty: i.qty, direction: 'OUT' }));
    return this.post('RTV', 'RTV', { vendorId: dto.vendorId, reason: dto.reason, occurredOn: dto.occurredOn, currency: dto.currency, items });
  }

  async writeOff(dto: WriteOffDto) {
    const items: AdjItem[] = dto.items.map((i) => ({ lotId: i.lotId, qty: i.qty, direction: 'OUT' }));
    return this.post('WRITEOFF', 'WOF', { reason: dto.reason, occurredOn: dto.occurredOn, currency: dto.currency, items });
  }

  /** Auto-write-off every expired lot still holding stock (the one-click expiry purge). */
  async writeOffExpired(dto: WriteOffExpiredDto) {
    return this.tenantTx.run(async (m) => {
      const expired = await this.stock.expiredLotsInTx(m);
      if (expired.length === 0) throw new BadRequestException('No expired stock to write off');
      const items: AdjItem[] = expired.map((l) => ({ lotId: l.id as string, qty: Number(l.qty_on_hand), direction: 'OUT' }));
      return this.postInTx(m, 'WRITEOFF', 'WOF', { reason: dto.reason ?? 'Expired stock', items });
    });
  }

  async adjustStock(dto: AdjustStockDto) {
    const items: AdjItem[] = dto.items.map((i) => ({ lotId: i.lotId, qty: i.qty, direction: i.direction }));
    return this.post('ADJUST', 'ADJ', { reason: dto.reason, occurredOn: dto.occurredOn, currency: dto.currency, items });
  }

  private async post(
    type: AdjType,
    prefix: keyof typeof DOC_PREFIX,
    p: { vendorId?: string; reason?: string; occurredOn?: string; currency?: string; items: AdjItem[] },
  ) {
    return this.tenantTx.run((m) => this.postInTx(m, type, prefix, p));
  }

  private async postInTx(
    m: EntityManager,
    type: AdjType,
    prefix: keyof typeof DOC_PREFIX,
    p: { vendorId?: string; reason?: string; occurredOn?: string; currency?: string; items: AdjItem[] },
  ) {
    if (p.items.length === 0) throw new BadRequestException('At least one item is required');
    const currency = p.currency ?? 'PKR';
    const adjNo = await this.nextDocNo(m, prefix);
    let header: Row;
    try {
      const rows = (await m.query(
        `INSERT INTO pharmacy_stock_adjustment (tenant_id, adj_no, type, vendor_id, reason, currency, total_minor, occurred_on, status, notes)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,0,COALESCE($6::date,current_date),'POSTED',$7)
         RETURNING id, adj_no`,
        [adjNo, type, p.vendorId ?? null, p.reason ?? null, currency, p.occurredOn ?? null, p.reason ?? null],
      )) as Row[];
      header = rows[0]!;
    } catch (err) {
      if ((err as { code?: string })?.code === '23503') throw new BadRequestException('Unknown vendor for this tenant');
      throw err;
    }
    const adjustmentId = header.id as string;

    let signedValue = 0; // positive = inventory decreased
    for (const item of p.items) {
      const lot = (await m.query(
        `SELECT product_id, lot_no, unit_cost_minor FROM pharmacy_stock_lot WHERE id=$1 AND deleted_at IS NULL`,
        [item.lotId],
      )) as Row[];
      if (!lot[0]) throw new NotFoundException('Stock lot not found');
      const productId = lot[0].product_id as string;
      const lotNo = lot[0].lot_no as string;
      let unitCost = Number(lot[0].unit_cost_minor);

      if (item.direction === 'OUT') {
        const res = await this.stock.decrementLotInTx(m, { lotId: item.lotId, productId, qty: item.qty, docType: type, docNo: adjNo });
        signedValue += res.valueMinor;
        unitCost = res.unitCostMinor;
      } else {
        await this.stock.restockInTx(m, { productId, lotId: item.lotId, qty: item.qty, unitCostMinor: unitCost, docType: type, docNo: adjNo });
        signedValue -= unitCost * item.qty;
      }

      await m.query(
        `INSERT INTO pharmacy_stock_adjustment_item (tenant_id, adjustment_id, product_id, lot_id, lot_no, direction, qty, unit_cost_minor)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)`,
        [adjustmentId, productId, item.lotId, lotNo, item.direction, item.qty, unitCost],
      );
    }

    await m.query(`UPDATE pharmacy_stock_adjustment SET total_minor=$1, updated_at=now() WHERE id=$2`, [signedValue, adjustmentId]);
    await this.outbox.write(m, EVENT_TYPES.PHARMACY_STOCK_ADJUSTED, { adjustmentId, adjNo, type, valueMinor: signedValue, currency });

    return { id: adjustmentId, adjNo, type, lines: p.items.length, value: money(signedValue, currency) };
  }

  async adjustmentForGlInTx(m: Mgr, id: string): Promise<AdjustmentForGl | null> {
    const rows = (await m.query(
      `SELECT adj_no, type, total_minor, occurred_on::text AS occurred_on FROM pharmacy_stock_adjustment WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) return null;
    return {
      adjNo: rows[0].adj_no as string,
      type: rows[0].type as AdjustmentForGl['type'],
      valueMinor: Number(rows[0].total_minor),
      occurredOn: (rows[0].occurred_on as string) ?? new Date().toISOString().slice(0, 10),
    };
  }

  async listAdjustments(type?: string) {
    return this.tenantTx.run((m) => {
      const conds = ['a.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (type) conds.push(`a.type = $${params.push(type)}`);
      return m.query(
        `SELECT a.id, a.adj_no, a.type, a.status, a.currency, a.total_minor, a.reason, a.occurred_on::text AS occurred_on,
                v.name AS vendor, count(i.id)::int AS line_count
         FROM pharmacy_stock_adjustment a
         LEFT JOIN vendor v ON v.id = a.vendor_id
         LEFT JOIN pharmacy_stock_adjustment_item i ON i.adjustment_id = a.id
         WHERE ${conds.join(' AND ')} GROUP BY a.id, v.name ORDER BY a.created_at DESC`,
        params,
      );
    });
  }

  async getAdjustment(id: string) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(
        `SELECT a.id, a.adj_no, a.type, a.status, a.currency, a.total_minor, a.reason, a.occurred_on::text AS occurred_on, v.name AS vendor
         FROM pharmacy_stock_adjustment a LEFT JOIN vendor v ON v.id = a.vendor_id WHERE a.id=$1 AND a.deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!h[0]) throw new NotFoundException('Adjustment not found');
      const items = (await m.query(
        `SELECT i.id, i.product_id, p.sku, p.name, i.lot_no, i.direction, i.qty, i.unit_cost_minor
         FROM pharmacy_stock_adjustment_item i JOIN inventory_product p ON p.id = i.product_id
         WHERE i.adjustment_id=$1 ORDER BY i.created_at`,
        [id],
      )) as Row[];
      const r = h[0];
      const cur = r.currency as string;
      return {
        id: r.id, adjNo: r.adj_no, type: r.type, status: r.status, currency: cur, reason: r.reason ?? null,
        vendor: r.vendor ?? null, occurredOn: r.occurred_on, value: money(r.total_minor, cur),
        items: items.map((i) => ({
          id: i.id, productId: i.product_id, sku: i.sku, name: i.name, lotNo: i.lot_no ?? null,
          direction: i.direction, qty: Number(i.qty), unitCost: money(i.unit_cost_minor, cur),
        })),
      };
    });
  }
}
