import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { InventoryDocsService } from '../inventory/inventory-docs.service';
import type { ReceiveBatchDto } from './dto/pharmacy.dto';
import { DOC_PREFIX, type LotLike, type Row, allocateFefo, formatDocNo, money } from './pharmacy.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Batch + expiry stock for pharmacy. Receipts create `pharmacy_stock_lot` rows (lot_no/expiry/cost)
 * and push value through the shared inventory valued ledger (weighted-average) so product on-hand and
 * stock value stay the one source of truth. `consumeFefoInTx` is the dispensing seam: it picks lots
 * first-expiry-first-out, decrements them, and moves the same quantity OUT of the valued ledger,
 * returning the (WAVG) COGS for GL posting. Near-expiry / expired / lot-valuation feed the reports.
 */
@Injectable()
export class PharmacyStockService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly inventoryDocs: InventoryDocsService,
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

  // ── Receive a batch (goods-in with lot + expiry) ──────────────────────────────
  async receiveBatch(dto: ReceiveBatchDto) {
    const currency = dto.currency ?? 'PKR';
    return this.tenantTx.run(async (m) => {
      const receiptNo = await this.nextDocNo(m, 'RCV');
      let total = 0;
      let vendorId = dto.vendorId ?? null;
      // Procurement tie-in: validate the PO and default the vendor from it.
      if (dto.poId) {
        const po = (await m.query(`SELECT vendor_id, status FROM inventory_purchase_order WHERE id=$1 AND deleted_at IS NULL`, [dto.poId])) as Row[];
        if (!po[0]) throw new BadRequestException('Purchase order not found');
        if (po[0].status === 'CANCELLED' || po[0].status === 'DRAFT') throw new UnprocessableEntityException('PO must be approved before receiving');
        vendorId = vendorId ?? (po[0].vendor_id as string | null);
      }
      let header: Row;
      try {
        const rows = (await m.query(
          `INSERT INTO pharmacy_receipt (tenant_id, receipt_no, vendor_id, warehouse_id, grn_id, po_id, received_on, currency, total_minor, notes, status)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,COALESCE($6::date,current_date),$7,0,$8,'POSTED')
           RETURNING id, receipt_no`,
          [receiptNo, vendorId, dto.warehouseId ?? null, dto.grnId ?? null, dto.poId ?? null, dto.receivedOn ?? null, currency, dto.notes ?? null],
        )) as Row[];
        header = rows[0]!;
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown vendor / warehouse / GRN / PO for this tenant');
        throw err;
      }

      for (const item of dto.items) {
        const unitCost = item.unitCostMinor ?? 0;
        // Find an existing open lot with the same lot_no + expiry to merge into, else create one.
        const existing = (await m.query(
          `SELECT id, qty_on_hand FROM pharmacy_stock_lot
           WHERE product_id=$1 AND lower(lot_no)=lower($2) AND COALESCE(expiry_date::text,'') = COALESCE($3::date::text,'')
             AND status='ACTIVE' AND deleted_at IS NULL FOR UPDATE`,
          [item.productId, item.lotNo, item.expiryDate ?? null],
        )) as Row[];

        let lotId: string;
        let balance: number;
        if (existing[0]) {
          lotId = existing[0].id as string;
          balance = Number(existing[0].qty_on_hand) + item.qty;
          await m.query(
            `UPDATE pharmacy_stock_lot SET qty_on_hand=$1, unit_cost_minor=$2, updated_at=now() WHERE id=$3`,
            [balance, unitCost, lotId],
          );
        } else {
          let lotRows: Row[];
          try {
            lotRows = (await m.query(
              `INSERT INTO pharmacy_stock_lot (tenant_id, product_id, lot_no, expiry_date, qty_on_hand, unit_cost_minor, vendor_id, received_on, doc_no, status)
               VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3::date,$4,$5,$6,COALESCE($7::date,current_date),$8,'ACTIVE')
               RETURNING id`,
              [item.productId, item.lotNo, item.expiryDate ?? null, item.qty, unitCost, dto.vendorId ?? null, dto.receivedOn ?? null, receiptNo],
            )) as Row[];
          } catch (err) {
            if (isForeignKey(err)) throw new BadRequestException('Unknown product for this tenant');
            throw err;
          }
          lotId = lotRows[0]!.id as string;
          balance = item.qty;
        }

        // Push value through the shared valued ledger (weighted-average) — one source of stock truth.
        await this.inventoryDocs.applyStockMovement(m, {
          productId: item.productId,
          docType: 'PH_RCV',
          docId: header.id as string,
          docNo: receiptNo,
          qtyIn: item.qty,
          unitCostMinor: unitCost,
          narration: `Pharmacy receipt ${receiptNo} · lot ${item.lotNo}`,
        });

        await m.query(
          `INSERT INTO pharmacy_lot_movement (tenant_id, lot_id, product_id, doc_type, doc_no, qty_in, balance_qty, occurred_on, narration)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,'RCV',$3,$4,$5,COALESCE($6::date,current_date),$7)`,
          [lotId, item.productId, receiptNo, item.qty, balance, dto.receivedOn ?? null, `Receipt ${receiptNo}`],
        );
        await m.query(
          `INSERT INTO pharmacy_receipt_item (tenant_id, receipt_id, product_id, lot_id, lot_no, expiry_date, qty, unit_cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5::date,$6,$7)`,
          [header.id, item.productId, lotId, item.lotNo, item.expiryDate ?? null, item.qty, unitCost],
        );
        total += item.qty * unitCost;
      }

      // Procurement tie-in: roll the received quantities onto the PO + refresh its status.
      if (dto.poId) {
        const poItems = (await m.query(`SELECT id, product_id FROM inventory_po_item WHERE po_id=$1`, [dto.poId])) as Row[];
        const byProduct = new Map(poItems.map((pi) => [pi.product_id as string, pi.id as string]));
        for (const item of dto.items) {
          const poItemId = byProduct.get(item.productId);
          if (poItemId) await m.query(`UPDATE inventory_po_item SET received_qty = received_qty + $1, updated_at=now() WHERE id=$2`, [item.qty, poItemId]);
        }
        await this.refreshPoStatus(m, dto.poId);
      }

      await m.query(`UPDATE pharmacy_receipt SET total_minor=$1, updated_at=now() WHERE id=$2`, [total, header.id]);
      return { id: header.id, receiptNo, lines: dto.items.length, total: money(total, currency) };
    });
  }

  private async refreshPoStatus(m: Mgr, poId: string) {
    const agg = (await m.query(
      `SELECT COALESCE(SUM(qty),0)::int AS ordered, COALESCE(SUM(received_qty),0)::int AS received FROM inventory_po_item WHERE po_id=$1`,
      [poId],
    )) as Array<{ ordered: number; received: number }>;
    const { ordered, received } = agg[0]!;
    const status = received <= 0 ? 'APPROVED' : received >= ordered ? 'RECEIVED' : 'PARTIAL';
    await m.query(`UPDATE inventory_purchase_order SET status=$1, updated_at=now() WHERE id=$2 AND status NOT IN ('CANCELLED','CLOSED')`, [status, poId]);
  }

  /**
   * Dispensing seam (used by the sale/issue flow): allocate `qty` FEFO across the product's lots,
   * decrement them, and move the same quantity OUT of the valued ledger. Returns the consumed COGS
   * (weighted-average, consistent with the rest of inventory) and the lot picks for traceability.
   * Runs INSIDE the caller's transaction so it commits atomically with the dispense write.
   */
  async consumeFefoInTx(
    m: Mgr,
    p: { productId: string; qty: number; docType: string; docId?: string | null; docNo?: string | null; allowShort?: boolean },
  ): Promise<{ cogsMinor: number; allocations: Array<{ lotId: string; lotNo: string; expiryDate: string | null; qty: number }> }> {
    const lotRows = (await m.query(
      `SELECT id, lot_no, expiry_date::text AS expiry_date, qty_on_hand, unit_cost_minor, received_on::text AS received_on
       FROM pharmacy_stock_lot WHERE product_id=$1 AND qty_on_hand > 0 AND status='ACTIVE' AND deleted_at IS NULL
       ORDER BY expiry_date ASC NULLS LAST, received_on ASC, id ASC FOR UPDATE`,
      [p.productId],
    )) as Row[];
    const lots: LotLike[] = lotRows.map((r) => ({
      id: r.id as string,
      lotNo: r.lot_no as string,
      expiryDate: (r.expiry_date as string) ?? null,
      qtyOnHand: Number(r.qty_on_hand),
      unitCostMinor: Number(r.unit_cost_minor),
      receivedOn: (r.received_on as string) ?? null,
    }));

    const { allocations } = allocateFefo(lots, p.qty, p.allowShort ?? false);
    for (const a of allocations) {
      await m.query(`UPDATE pharmacy_stock_lot SET qty_on_hand = qty_on_hand - $1, updated_at=now() WHERE id=$2`, [a.qty, a.lotId]);
      const bal = (await m.query(`SELECT qty_on_hand FROM pharmacy_stock_lot WHERE id=$1`, [a.lotId])) as Row[];
      await m.query(
        `INSERT INTO pharmacy_lot_movement (tenant_id, lot_id, product_id, doc_type, doc_no, qty_out, balance_qty, narration)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)`,
        [a.lotId, p.productId, p.docType, p.docNo ?? null, a.qty, Number(bal[0]!.qty_on_hand), `${p.docType} ${p.docNo ?? ''}`.trim()],
      );
    }

    const allocated = allocations.reduce((s, a) => s + a.qty, 0);
    let cogsMinor = 0;
    if (allocated > 0) {
      const res = await this.inventoryDocs.applyStockMovement(m, {
        productId: p.productId,
        docType: p.docType,
        docId: p.docId ?? null,
        docNo: p.docNo ?? null,
        qtyOut: allocated,
        narration: `${p.docType} ${p.docNo ?? ''}`.trim(),
      });
      cogsMinor = res.unitCostMinor * allocated;
    }
    return { cogsMinor, allocations: allocations.map((a) => ({ lotId: a.lotId, lotNo: a.lotNo, expiryDate: a.expiryDate, qty: a.qty })) };
  }

  /**
   * Restock seam (used by returns/void): put `qty` back — into the original lot when `lotId` is known
   * (revives a depleted lot), and into the valued ledger at `unitCostMinor`. Runs in the caller's tx.
   */
  async restockInTx(
    m: Mgr,
    p: { productId: string; lotId?: string | null; qty: number; unitCostMinor: number; docType: string; docNo?: string | null },
  ): Promise<void> {
    if (p.qty <= 0) return;
    if (p.lotId) {
      await m.query(`UPDATE pharmacy_stock_lot SET qty_on_hand = qty_on_hand + $1, updated_at=now() WHERE id=$2`, [p.qty, p.lotId]);
      const bal = (await m.query(`SELECT qty_on_hand FROM pharmacy_stock_lot WHERE id=$1`, [p.lotId])) as Row[];
      await m.query(
        `INSERT INTO pharmacy_lot_movement (tenant_id, lot_id, product_id, doc_type, doc_no, qty_in, balance_qty, narration)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)`,
        [p.lotId, p.productId, p.docType, p.docNo ?? null, p.qty, Number(bal[0]!.qty_on_hand), `${p.docType} ${p.docNo ?? ''}`.trim()],
      );
    }
    await this.inventoryDocs.applyStockMovement(m, {
      productId: p.productId,
      docType: p.docType,
      docNo: p.docNo ?? null,
      qtyIn: p.qty,
      unitCostMinor: p.unitCostMinor,
      narration: `${p.docType} ${p.docNo ?? ''}`.trim(),
    });
  }

  /**
   * Decrement a SPECIFIC lot (used by return-to-vendor / write-off / negative adjustment, which target
   * a chosen lot rather than FEFO). Locks the lot, guards on-hand, logs the movement, and moves the
   * same quantity OUT of the valued ledger. Returns the WAVG value consumed + the lot number.
   */
  async decrementLotInTx(
    m: Mgr,
    p: { lotId: string; productId: string; qty: number; docType: string; docNo?: string | null },
  ): Promise<{ valueMinor: number; unitCostMinor: number; lotNo: string }> {
    const rows = (await m.query(
      `SELECT lot_no, qty_on_hand FROM pharmacy_stock_lot WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [p.lotId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Stock lot not found');
    const lotNo = rows[0].lot_no as string;
    if (Number(rows[0].qty_on_hand) < p.qty) {
      throw new UnprocessableEntityException(`Lot ${lotNo}: only ${rows[0].qty_on_hand} on hand, cannot remove ${p.qty}`);
    }
    await m.query(`UPDATE pharmacy_stock_lot SET qty_on_hand = qty_on_hand - $1, updated_at=now() WHERE id=$2`, [p.qty, p.lotId]);
    const bal = (await m.query(`SELECT qty_on_hand FROM pharmacy_stock_lot WHERE id=$1`, [p.lotId])) as Row[];
    await m.query(
      `INSERT INTO pharmacy_lot_movement (tenant_id, lot_id, product_id, doc_type, doc_no, qty_out, balance_qty, narration)
       VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)`,
      [p.lotId, p.productId, p.docType, p.docNo ?? null, p.qty, Number(bal[0]!.qty_on_hand), `${p.docType} ${p.docNo ?? ''}`.trim()],
    );
    const res = await this.inventoryDocs.applyStockMovement(m, {
      productId: p.productId, docType: p.docType, docNo: p.docNo ?? null, qtyOut: p.qty,
      narration: `${p.docType} ${p.docNo ?? ''}`.trim(),
    });
    return { valueMinor: res.unitCostMinor * p.qty, unitCostMinor: res.unitCostMinor, lotNo };
  }

  /** Expired lots (qty>0) as the write-off candidates — used to auto-build an expiry write-off. */
  async expiredLotsInTx(m: Mgr) {
    return (await m.query(
      `SELECT id, product_id, lot_no, qty_on_hand, unit_cost_minor FROM pharmacy_stock_lot
       WHERE deleted_at IS NULL AND status='ACTIVE' AND qty_on_hand > 0 AND expiry_date IS NOT NULL AND expiry_date < current_date
       ORDER BY expiry_date ASC FOR UPDATE`,
    )) as Row[];
  }

  // ── Lot queries / reports ─────────────────────────────────────────────────────
  async listLots(productId?: string) {
    return this.tenantTx.run(async (m) => {
      const conds = ['l.deleted_at IS NULL', "l.status='ACTIVE'"];
      const params: unknown[] = [];
      if (productId) conds.push(`l.product_id = $${params.push(productId)}`);
      const rows = (await m.query(
        `SELECT l.id, l.product_id, p.sku, p.name, l.lot_no, l.expiry_date::text AS expiry_date, l.qty_on_hand,
                l.unit_cost_minor, p.currency, l.received_on::text AS received_on, l.doc_no
         FROM pharmacy_stock_lot l JOIN inventory_product p ON p.id = l.product_id
         WHERE ${conds.join(' AND ')} ORDER BY p.name, l.expiry_date ASC NULLS LAST`,
        params,
      )) as Row[];
      return rows.map((r) => this.mapLot(r));
    });
  }

  /** Non-mutating FEFO preview — what lots would a dispense of `qty` consume? */
  async fefoPreview(productId: string, qty: number) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, lot_no, expiry_date::text AS expiry_date, qty_on_hand, unit_cost_minor, received_on::text AS received_on
         FROM pharmacy_stock_lot WHERE product_id=$1 AND qty_on_hand > 0 AND status='ACTIVE' AND deleted_at IS NULL`,
        [productId],
      )) as Row[];
      const lots: LotLike[] = rows.map((r) => ({
        id: r.id as string, lotNo: r.lot_no as string, expiryDate: (r.expiry_date as string) ?? null,
        qtyOnHand: Number(r.qty_on_hand), unitCostMinor: Number(r.unit_cost_minor), receivedOn: (r.received_on as string) ?? null,
      }));
      const { allocations, costMinor, shortBy } = allocateFefo(lots, qty, true);
      return {
        productId, requested: qty, fulfilled: qty - shortBy, shortBy,
        cost: money(costMinor), allocations,
      };
    });
  }

  /** Lots expiring within `days` (default from config not applied here; caller passes days). */
  async nearExpiry(days: number) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT l.id, l.product_id, p.sku, p.name, l.lot_no, l.expiry_date::text AS expiry_date, l.qty_on_hand,
                l.unit_cost_minor, p.currency, (l.expiry_date - current_date) AS days_left
         FROM pharmacy_stock_lot l JOIN inventory_product p ON p.id = l.product_id
         WHERE l.deleted_at IS NULL AND l.status='ACTIVE' AND l.qty_on_hand > 0
           AND l.expiry_date IS NOT NULL AND l.expiry_date <= current_date + ($1 || ' days')::interval
         ORDER BY l.expiry_date ASC`,
        [days],
      )) as Row[];
      return rows.map((r) => ({ ...this.mapLot(r), daysLeft: Number(r.days_left) }));
    });
  }

  /** Already-expired lots still holding stock (write-off candidates). */
  async expiredStock() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT l.id, l.product_id, p.sku, p.name, l.lot_no, l.expiry_date::text AS expiry_date, l.qty_on_hand,
                l.unit_cost_minor, p.currency
         FROM pharmacy_stock_lot l JOIN inventory_product p ON p.id = l.product_id
         WHERE l.deleted_at IS NULL AND l.status='ACTIVE' AND l.qty_on_hand > 0
           AND l.expiry_date IS NOT NULL AND l.expiry_date < current_date
         ORDER BY l.expiry_date ASC`,
      )) as Row[];
      return rows.map((r) => this.mapLot(r));
    });
  }

  private mapLot(r: Row) {
    const cur = (r.currency as string) ?? 'PKR';
    const qty = Number(r.qty_on_hand);
    const unit = Number(r.unit_cost_minor);
    return {
      id: r.id, productId: r.product_id, sku: r.sku, name: r.name, lotNo: r.lot_no,
      expiryDate: (r.expiry_date as string) ?? null, qtyOnHand: qty, unitCost: money(unit, cur),
      value: money(qty * unit, cur), receivedOn: (r.received_on as string) ?? null, docNo: r.doc_no ?? null,
    };
  }
}

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isForeignKey = (e: unknown) => code(e) === '23503';
