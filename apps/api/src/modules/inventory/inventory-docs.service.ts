import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type {
  AdjustStockDto,
  CreateGatePassDto,
  CreateGrnDto,
  CreateIssueDto,
  CreateMrnDto,
  CreatePurchaseOrderDto,
  CreateRequisitionDto,
  LedgerQueryDto,
} from './dto/inventory-docs.dto';
import { DOC_PREFIX, type Row, formatDocNo, mapLedgerRow, money } from './inventory-docs.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Enterprise inventory documents. The backbone is `postLedger`: every stock movement (opening,
 * adjustment, GRN receipt, store issuance, material return) appends one valued ledger row and keeps
 * `inventory_product.on_hand` + `stock_value_minor` in sync, recomputing the weighted-average unit cost.
 * The `CHECK (on_hand >= 0)` on the product guards overselling — a failing issue rolls the whole
 * document back. Document numbers are allocated per-tenant, per-type from `inventory_doc_seq`.
 */
@Injectable()
export class InventoryDocsService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  // ── Ledger backbone (weighted-average cost) ─────────────────────────────────
  private async postLedger(
    m: Mgr,
    p: {
      productId: string;
      warehouseId?: string | null;
      docType: string;
      docId?: string | null;
      docNo?: string | null;
      qtyIn?: number;
      qtyOut?: number;
      unitCostMinor?: number;
      occurredOn?: string | null;
      narration?: string | null;
    },
  ): Promise<{ unitCostMinor: number; balanceQty: number; balanceValueMinor: number }> {
    const prod = (await m.query(
      `SELECT on_hand, stock_value_minor, cost_price_minor FROM inventory_product WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [p.productId],
    )) as Array<{ on_hand: number; stock_value_minor: string; cost_price_minor: string }>;
    if (!prod[0]) throw new NotFoundException('Product not found');
    const curQty = Number(prod[0].on_hand);
    const curValue = Number(prod[0].stock_value_minor);
    const qtyIn = p.qtyIn ?? 0;
    const qtyOut = p.qtyOut ?? 0;

    let unitCost: number;
    let valueIn = 0;
    let valueOut = 0;
    if (qtyIn > 0) {
      unitCost = p.unitCostMinor ?? (curQty > 0 ? Math.round(curValue / curQty) : 0);
      valueIn = qtyIn * unitCost;
    } else {
      // Outbound — value at the current weighted-average cost.
      unitCost = curQty > 0 ? Math.round(curValue / curQty) : Number(prod[0].cost_price_minor);
      valueOut = qtyOut * unitCost;
    }
    const newQty = curQty + qtyIn - qtyOut;
    let newValue = curValue + valueIn - valueOut;
    if (newQty <= 0) newValue = 0; // fully depleted → no residual value from rounding
    const newWavg = newQty > 0 ? Math.round(newValue / newQty) : qtyIn > 0 ? unitCost : Number(prod[0].cost_price_minor);

    try {
      await m.query(
        `UPDATE inventory_product SET on_hand=$1, stock_value_minor=$2, cost_price_minor=$3, updated_at=now() WHERE id=$4`,
        [newQty, newValue, newWavg, p.productId],
      );
    } catch (err) {
      if (isCheck(err)) {
        throw new UnprocessableEntityException(`Insufficient stock: on hand ${curQty}, requested out ${qtyOut}`);
      }
      throw err;
    }

    await m.query(
      `INSERT INTO inventory_ledger
         (tenant_id, product_id, warehouse_id, doc_type, doc_id, doc_no, qty_in, qty_out, unit_cost_minor,
          value_in_minor, value_out_minor, balance_qty, balance_value_minor, occurred_on, narration)
       VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13::date, current_date), $14)`,
      [
        p.productId, p.warehouseId ?? null, p.docType, p.docId ?? null, p.docNo ?? null,
        qtyIn, qtyOut, unitCost, valueIn, valueOut, newQty, newValue, p.occurredOn ?? null, p.narration ?? null,
      ],
    );
    return { unitCostMinor: unitCost, balanceQty: newQty, balanceValueMinor: newValue };
  }

  /** Allocate the next per-tenant, per-type document number atomically. */
  private async nextDocNo(m: Mgr, docType: keyof typeof DOC_PREFIX): Promise<string> {
    const seq = (await m.query(
      `INSERT INTO inventory_doc_seq (tenant_id, doc_type, last_no)
       VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
       ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = inventory_doc_seq.last_no + 1
       RETURNING last_no`,
      [docType],
    )) as Array<{ last_no: string }>;
    return formatDocNo(DOC_PREFIX[docType], Number(seq[0]!.last_no));
  }

  // ── Opening stock / adjustment ──────────────────────────────────────────────
  async adjustStock(dto: AdjustStockDto) {
    if (!dto.quantity) throw new BadRequestException('quantity must be non-zero');
    const docType = (dto.docType ?? 'ADJUST') as 'OPENING' | 'ADJUST';
    return this.tenantTx.run(async (m) => {
      const docNo = await this.nextDocNo(m, docType);
      const isIn = dto.quantity > 0;
      const res = await this.postLedger(m, {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        docType,
        docNo,
        qtyIn: isIn ? dto.quantity : 0,
        qtyOut: isIn ? 0 : -dto.quantity,
        unitCostMinor: dto.unitCostMinor,
        narration: dto.narration,
      });
      return { docNo, docType, ...res };
    });
  }

  // ── Reports ─────────────────────────────────────────────────────────────────
  async itemLedger(productId: string, query: LedgerQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['product_id = $1', 'deleted_at IS NULL'];
      const params: unknown[] = [productId];
      if (query.from) conds.push(`occurred_on >= $${params.push(query.from)}`);
      if (query.to) conds.push(`occurred_on <= $${params.push(query.to)}`);
      const rows = (await m.query(
        `SELECT id, product_id, warehouse_id, doc_type, doc_no, qty_in, qty_out, unit_cost_minor,
                value_in_minor, value_out_minor, balance_qty, balance_value_minor, occurred_on::text AS occurred_on, narration
         FROM inventory_ledger WHERE ${conds.join(' AND ')} ORDER BY created_at`,
        params,
      )) as Row[];
      return rows.map(mapLedgerRow);
    });
  }

  /** Stock valuation: every product with its on-hand qty, weighted-average cost, and total value. */
  async stockReport() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, sku, name, unit, category, currency, on_hand, min_stock, cost_price_minor, stock_value_minor
         FROM inventory_product WHERE deleted_at IS NULL ORDER BY name`,
      )) as Row[];
      const lines = rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        category: r.category ?? null,
        onHand: Number(r.on_hand),
        minStock: Number(r.min_stock),
        unitCost: money(r.cost_price_minor, r.currency as string),
        value: money(r.stock_value_minor, r.currency as string),
        belowReorder: Number(r.on_hand) < Number(r.min_stock),
      }));
      const totalValueMinor = lines.reduce((s, l) => s + l.value.amountMinor, 0);
      return { lines, totals: { items: lines.length, value: money(totalValueMinor) } };
    });
  }

  /** Reorder report: products at or below their reorder point, with the suggested top-up quantity. */
  async reorderReport() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, sku, name, unit, on_hand, min_stock FROM inventory_product
         WHERE deleted_at IS NULL AND on_hand <= min_stock AND min_stock > 0 ORDER BY (min_stock - on_hand) DESC`,
      )) as Row[];
      return rows.map((r) => ({
        id: r.id, sku: r.sku, name: r.name, unit: r.unit,
        onHand: Number(r.on_hand), minStock: Number(r.min_stock),
        suggestedQty: Math.max(0, Number(r.min_stock) - Number(r.on_hand)),
      }));
    });
  }

  // ── Requisition ─────────────────────────────────────────────────────────────
  async createRequisition(dto: CreateRequisitionDto) {
    return this.tenantTx.run(async (m) => {
      const reqNo = await this.nextDocNo(m, 'REQ');
      const header = (await m.query(
        `INSERT INTO inventory_requisition (tenant_id, req_no, warehouse_id, requested_by, department, needed_by, notes, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,'DRAFT')
         RETURNING id, req_no, status`,
        [reqNo, dto.warehouseId ?? null, dto.requestedBy ?? null, dto.department ?? null, dto.neededBy ?? null, dto.notes ?? null],
      )) as Row[];
      const req = header[0]!;
      await this.insertItems(m, 'inventory_requisition_item', 'requisition_id', req.id as string, dto.items.map((i) => [i.productId, i.qty]));
      return { id: req.id, reqNo: req.req_no, status: req.status, items: dto.items.length };
    });
  }

  async listRequisitions() {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT r.id, r.req_no, r.status, r.requested_by, r.department, r.needed_by::text AS needed_by,
                w.name AS warehouse, count(i.id)::int AS item_count
         FROM inventory_requisition r
         LEFT JOIN inventory_warehouse w ON w.id = r.warehouse_id
         LEFT JOIN inventory_requisition_item i ON i.requisition_id = r.id
         WHERE r.deleted_at IS NULL
         GROUP BY r.id, w.name ORDER BY r.created_at DESC`,
      ),
    );
  }

  async getRequisition(id: string) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(`SELECT id, req_no, status, requested_by, department, needed_by::text AS needed_by, notes FROM inventory_requisition WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      if (!h[0]) throw new NotFoundException('Requisition not found');
      const items = (await m.query(
        `SELECT ri.id, ri.product_id, p.sku, p.name, ri.qty, ri.issued_qty
         FROM inventory_requisition_item ri JOIN inventory_product p ON p.id = ri.product_id
         WHERE ri.requisition_id=$1 ORDER BY ri.created_at`,
        [id],
      )) as Row[];
      return { ...h[0], items };
    });
  }

  async setRequisitionStatus(id: string, to: 'SUBMITTED' | 'APPROVED' | 'CANCELLED') {
    const allowed: Record<string, string[]> = {
      SUBMITTED: ['DRAFT'],
      APPROVED: ['SUBMITTED'],
      CANCELLED: ['DRAFT', 'SUBMITTED', 'APPROVED'],
    };
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status FROM inventory_requisition WHERE id=$1 AND deleted_at IS NULL`, [id])) as Array<{ status: string }>;
      if (!cur[0]) throw new NotFoundException('Requisition not found');
      if (!(allowed[to] ?? []).includes(cur[0].status)) {
        throw new UnprocessableEntityException(`Cannot move a ${cur[0].status} requisition to ${to}`);
      }
      await m.query(`UPDATE inventory_requisition SET status=$1, updated_at=now() WHERE id=$2`, [to, id]);
      return { id, status: to };
    });
  }

  // ── Purchase order ──────────────────────────────────────────────────────────
  async createPurchaseOrder(dto: CreatePurchaseOrderDto) {
    return this.tenantTx.run(async (m) => {
      const poNo = await this.nextDocNo(m, 'PO');
      const total = dto.items.reduce((s, i) => s + i.qty * (i.unitPriceMinor ?? 0), 0);
      let header: Row;
      try {
        const rows = (await m.query(
          `INSERT INTO inventory_purchase_order (tenant_id, po_no, vendor_id, requisition_id, warehouse_id, currency, total_minor, expected_on, notes, status)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,'DRAFT')
           RETURNING id, po_no, status, total_minor, currency`,
          [poNo, dto.vendorId ?? null, dto.requisitionId ?? null, dto.warehouseId ?? null, dto.currency ?? 'PKR', total, dto.expectedOn ?? null, dto.notes ?? null],
        )) as Row[];
        header = rows[0]!;
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown vendor / requisition / warehouse for this tenant');
        throw err;
      }
      await this.insertPoItems(m, header.id as string, dto.items);
      return { id: header.id, poNo: header.po_no, status: header.status, total: money(header.total_minor, header.currency as string), items: dto.items.length };
    });
  }

  async listPurchaseOrders() {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT po.id, po.po_no, po.status, po.currency, po.total_minor, po.expected_on::text AS expected_on,
                v.name AS vendor,
                COALESCE(SUM(pi.qty),0)::int AS ordered_qty, COALESCE(SUM(pi.received_qty),0)::int AS received_qty
         FROM inventory_purchase_order po
         LEFT JOIN vendor v ON v.id = po.vendor_id
         LEFT JOIN inventory_po_item pi ON pi.po_id = po.id
         WHERE po.deleted_at IS NULL
         GROUP BY po.id, v.name ORDER BY po.created_at DESC`,
      ),
    );
  }

  async getPurchaseOrder(id: string) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(
        `SELECT po.id, po.po_no, po.status, po.currency, po.total_minor, po.expected_on::text AS expected_on, po.notes, v.name AS vendor
         FROM inventory_purchase_order po LEFT JOIN vendor v ON v.id = po.vendor_id
         WHERE po.id=$1 AND po.deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!h[0]) throw new NotFoundException('Purchase order not found');
      const items = (await m.query(
        `SELECT pi.id, pi.product_id, p.sku, p.name, pi.qty, pi.received_qty, pi.unit_price_minor
         FROM inventory_po_item pi JOIN inventory_product p ON p.id = pi.product_id
         WHERE pi.po_id=$1 ORDER BY pi.created_at`,
        [id],
      )) as Row[];
      const cur = h[0].currency as string;
      return {
        ...h[0],
        total: money(h[0].total_minor, cur),
        items: items.map((i) => ({ id: i.id, productId: i.product_id, sku: i.sku, name: i.name, qty: Number(i.qty), receivedQty: Number(i.received_qty), unitPrice: money(i.unit_price_minor, cur) })),
      };
    });
  }

  async setPurchaseOrderStatus(id: string, to: 'APPROVED' | 'CANCELLED') {
    const allowed: Record<string, string[]> = { APPROVED: ['DRAFT'], CANCELLED: ['DRAFT', 'APPROVED', 'PARTIAL'] };
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status FROM inventory_purchase_order WHERE id=$1 AND deleted_at IS NULL`, [id])) as Array<{ status: string }>;
      if (!cur[0]) throw new NotFoundException('Purchase order not found');
      if (!(allowed[to] ?? []).includes(cur[0].status)) throw new UnprocessableEntityException(`Cannot move a ${cur[0].status} PO to ${to}`);
      await m.query(`UPDATE inventory_purchase_order SET status=$1, updated_at=now() WHERE id=$2`, [to, id]);
      return { id, status: to };
    });
  }

  // ── Goods Receipt Note (receive into stock) ─────────────────────────────────
  async createGrn(dto: CreateGrnDto) {
    return this.tenantTx.run(async (m) => {
      // Resolve the lines to receive: explicit items, or the PO's outstanding quantities.
      let lines: Array<{ productId: string; qty: number; unitCostMinor: number; poItemId?: string }> = [];
      let vendorId = dto.vendorId ?? null;
      let warehouseId = dto.warehouseId ?? null;
      if (dto.poId) {
        const po = (await m.query(`SELECT id, vendor_id, warehouse_id, status FROM inventory_purchase_order WHERE id=$1 AND deleted_at IS NULL`, [dto.poId])) as Row[];
        if (!po[0]) throw new BadRequestException('Purchase order not found');
        if (po[0].status === 'CANCELLED' || po[0].status === 'DRAFT') throw new UnprocessableEntityException('PO must be approved before receiving');
        vendorId = vendorId ?? (po[0].vendor_id as string | null);
        warehouseId = warehouseId ?? (po[0].warehouse_id as string | null);
        const poItems = (await m.query(`SELECT id, product_id, qty, received_qty, unit_price_minor FROM inventory_po_item WHERE po_id=$1`, [dto.poId])) as Row[];
        if (dto.items?.length) {
          const byProduct = new Map(poItems.map((p) => [p.product_id as string, p]));
          lines = dto.items.map((i) => {
            const pi = byProduct.get(i.productId);
            return { productId: i.productId, qty: i.qty, unitCostMinor: i.unitCostMinor ?? Number(pi?.unit_price_minor ?? 0), poItemId: pi?.id as string | undefined };
          });
        } else {
          lines = poItems
            .map((p) => ({ productId: p.product_id as string, qty: Number(p.qty) - Number(p.received_qty), unitCostMinor: Number(p.unit_price_minor), poItemId: p.id as string }))
            .filter((l) => l.qty > 0);
        }
        if (lines.length === 0) throw new UnprocessableEntityException('Nothing outstanding to receive on this PO');
      } else {
        if (!dto.items?.length) throw new BadRequestException('A GRN needs a PO or explicit items');
        lines = dto.items.map((i) => ({ productId: i.productId, qty: i.qty, unitCostMinor: i.unitCostMinor ?? 0 }));
      }

      const grnNo = await this.nextDocNo(m, 'GRN');
      let header: Row;
      try {
        const rows = (await m.query(
          `INSERT INTO inventory_grn (tenant_id, grn_no, po_id, vendor_id, warehouse_id, gate_pass_id, received_on, notes, status)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,COALESCE($6::date,current_date),$7,'POSTED')
           RETURNING id, grn_no, status`,
          [grnNo, dto.poId ?? null, vendorId, warehouseId, dto.gatePassId ?? null, dto.receivedOn ?? null, dto.notes ?? null],
        )) as Row[];
        header = rows[0]!;
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown PO / vendor / warehouse / gate pass for this tenant');
        throw err;
      }

      for (const l of lines) {
        await m.query(
          `INSERT INTO inventory_grn_item (tenant_id, grn_id, product_id, qty, unit_cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)`,
          [header.id, l.productId, l.qty, l.unitCostMinor],
        );
        await this.postLedger(m, {
          productId: l.productId, warehouseId, docType: 'GRN', docId: header.id as string, docNo: grnNo,
          qtyIn: l.qty, unitCostMinor: l.unitCostMinor, occurredOn: dto.receivedOn, narration: `GRN ${grnNo}`,
        });
        if (l.poItemId) {
          await m.query(`UPDATE inventory_po_item SET received_qty = received_qty + $1, updated_at=now() WHERE id=$2`, [l.qty, l.poItemId]);
        }
      }

      if (dto.poId) await this.refreshPoStatus(m, dto.poId);
      return { id: header.id, grnNo, status: header.status, lines: lines.length };
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

  // ── Gate pass ───────────────────────────────────────────────────────────────
  async createGatePass(dto: CreateGatePassDto) {
    return this.tenantTx.run(async (m) => {
      const gpNo = await this.nextDocNo(m, 'GP');
      const header = (await m.query(
        `INSERT INTO inventory_gate_pass (tenant_id, gp_no, direction, returnable, party, vehicle_no, issued_on, remarks, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,COALESCE($6::date,current_date),$7,'OPEN')
         RETURNING id, gp_no, direction, status`,
        [gpNo, dto.direction, dto.returnable ?? false, dto.party ?? null, dto.vehicleNo ?? null, dto.issuedOn ?? null, dto.remarks ?? null],
      )) as Row[];
      const gp = header[0]!;
      for (const i of dto.items) {
        await m.query(
          `INSERT INTO inventory_gate_pass_item (tenant_id, gate_pass_id, product_id, description, qty)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)`,
          [gp.id, i.productId ?? null, i.description, i.qty],
        );
      }
      return { id: gp.id, gpNo: gp.gp_no, direction: gp.direction, status: gp.status, items: dto.items.length };
    });
  }

  async listGatePasses() {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT g.id, g.gp_no, g.direction, g.returnable, g.party, g.vehicle_no, g.status, g.issued_on::text AS issued_on,
                count(i.id)::int AS item_count
         FROM inventory_gate_pass g LEFT JOIN inventory_gate_pass_item i ON i.gate_pass_id = g.id
         WHERE g.deleted_at IS NULL GROUP BY g.id ORDER BY g.created_at DESC`,
      ),
    );
  }

  async closeGatePass(id: string) {
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status FROM inventory_gate_pass WHERE id=$1 AND deleted_at IS NULL`, [id])) as Array<{ status: string }>;
      if (!cur[0]) throw new NotFoundException('Gate pass not found');
      if (cur[0].status !== 'OPEN') throw new UnprocessableEntityException(`Gate pass is already ${cur[0].status}`);
      await m.query(`UPDATE inventory_gate_pass SET status='CLOSED', updated_at=now() WHERE id=$1`, [id]);
      return { id, status: 'CLOSED' };
    });
  }

  // ── Store issuance (issue out, optionally against a requisition) ─────────────
  async createIssue(dto: CreateIssueDto) {
    return this.tenantTx.run(async (m) => {
      let lines: Array<{ productId: string; qty: number; reqItemId?: string }> = [];
      let warehouseId = dto.warehouseId ?? null;
      if (dto.requisitionId) {
        const req = (await m.query(`SELECT id, warehouse_id, status FROM inventory_requisition WHERE id=$1 AND deleted_at IS NULL`, [dto.requisitionId])) as Row[];
        if (!req[0]) throw new BadRequestException('Requisition not found');
        if (req[0].status !== 'APPROVED') throw new UnprocessableEntityException('Requisition must be APPROVED before issuing');
        warehouseId = warehouseId ?? (req[0].warehouse_id as string | null);
        const reqItems = (await m.query(`SELECT id, product_id, qty, issued_qty FROM inventory_requisition_item WHERE requisition_id=$1`, [dto.requisitionId])) as Row[];
        if (dto.items?.length) {
          const byProduct = new Map(reqItems.map((r) => [r.product_id as string, r]));
          lines = dto.items.map((i) => ({ productId: i.productId, qty: i.qty, reqItemId: byProduct.get(i.productId)?.id as string | undefined }));
        } else {
          lines = reqItems
            .map((r) => ({ productId: r.product_id as string, qty: Number(r.qty) - Number(r.issued_qty), reqItemId: r.id as string }))
            .filter((l) => l.qty > 0);
        }
        if (lines.length === 0) throw new UnprocessableEntityException('Nothing outstanding to issue on this requisition');
      } else {
        if (!dto.items?.length) throw new BadRequestException('An issue needs a requisition or explicit items');
        lines = dto.items.map((i) => ({ productId: i.productId, qty: i.qty }));
      }

      const issueNo = await this.nextDocNo(m, 'ISSUE');
      const header = (await m.query(
        `INSERT INTO inventory_issue (tenant_id, issue_no, requisition_id, warehouse_id, issued_to, department, issued_on, notes, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,COALESCE($6::date,current_date),$7,'POSTED')
         RETURNING id, issue_no, status`,
        [issueNo, dto.requisitionId ?? null, warehouseId, dto.issuedTo ?? null, dto.department ?? null, dto.issuedOn ?? null, dto.notes ?? null],
      )) as Row[];
      const issue = header[0]!;

      for (const l of lines) {
        const res = await this.postLedger(m, {
          productId: l.productId, warehouseId, docType: 'ISSUE', docId: issue.id as string, docNo: issueNo,
          qtyOut: l.qty, occurredOn: dto.issuedOn, narration: `Issue ${issueNo}`,
        });
        await m.query(
          `INSERT INTO inventory_issue_item (tenant_id, issue_id, product_id, qty, unit_cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)`,
          [issue.id, l.productId, l.qty, res.unitCostMinor],
        );
        if (l.reqItemId) await m.query(`UPDATE inventory_requisition_item SET issued_qty = issued_qty + $1, updated_at=now() WHERE id=$2`, [l.qty, l.reqItemId]);
      }

      if (dto.requisitionId) await this.refreshRequisitionStatus(m, dto.requisitionId);
      return { id: issue.id, issueNo, status: issue.status, lines: lines.length };
    });
  }

  private async refreshRequisitionStatus(m: Mgr, reqId: string) {
    const agg = (await m.query(
      `SELECT COALESCE(SUM(qty),0)::int AS req, COALESCE(SUM(issued_qty),0)::int AS issued FROM inventory_requisition_item WHERE requisition_id=$1`,
      [reqId],
    )) as Array<{ req: number; issued: number }>;
    if (agg[0]!.issued >= agg[0]!.req && agg[0]!.req > 0) {
      await m.query(`UPDATE inventory_requisition SET status='ISSUED', updated_at=now() WHERE id=$1 AND status='APPROVED'`, [reqId]);
    }
  }

  // ── Material Return Note (return issued stock to the store) ──────────────────
  async createMrn(dto: CreateMrnDto) {
    return this.tenantTx.run(async (m) => {
      let lines: Array<{ productId: string; qty: number; unitCostMinor: number; issueItemId?: string }> = [];
      let warehouseId = dto.warehouseId ?? null;
      if (dto.issueId) {
        const issue = (await m.query(`SELECT id, warehouse_id FROM inventory_issue WHERE id=$1 AND deleted_at IS NULL`, [dto.issueId])) as Row[];
        if (!issue[0]) throw new BadRequestException('Issue not found');
        warehouseId = warehouseId ?? (issue[0].warehouse_id as string | null);
        const issueItems = (await m.query(`SELECT id, product_id, qty, returned_qty, unit_cost_minor FROM inventory_issue_item WHERE issue_id=$1`, [dto.issueId])) as Row[];
        if (dto.items?.length) {
          const byProduct = new Map(issueItems.map((r) => [r.product_id as string, r]));
          lines = dto.items.map((i) => {
            const ii = byProduct.get(i.productId);
            return { productId: i.productId, qty: i.qty, unitCostMinor: Number(ii?.unit_cost_minor ?? 0), issueItemId: ii?.id as string | undefined };
          });
        } else {
          lines = issueItems
            .map((r) => ({ productId: r.product_id as string, qty: Number(r.qty) - Number(r.returned_qty), unitCostMinor: Number(r.unit_cost_minor), issueItemId: r.id as string }))
            .filter((l) => l.qty > 0);
        }
        if (lines.length === 0) throw new UnprocessableEntityException('Nothing outstanding to return on this issue');
      } else {
        if (!dto.items?.length) throw new BadRequestException('An MRN needs an issue or explicit items');
        lines = dto.items.map((i) => ({ productId: i.productId, qty: i.qty, unitCostMinor: 0 }));
      }

      const mrnNo = await this.nextDocNo(m, 'MRN');
      const header = (await m.query(
        `INSERT INTO inventory_mrn (tenant_id, mrn_no, issue_id, warehouse_id, returned_by, returned_on, notes, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,COALESCE($5::date,current_date),$6,'POSTED')
         RETURNING id, mrn_no, status`,
        [mrnNo, dto.issueId ?? null, warehouseId, dto.returnedBy ?? null, dto.returnedOn ?? null, dto.notes ?? null],
      )) as Row[];
      const mrn = header[0]!;

      for (const l of lines) {
        await m.query(
          `INSERT INTO inventory_mrn_item (tenant_id, mrn_id, product_id, qty, unit_cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)`,
          [mrn.id, l.productId, l.qty, l.unitCostMinor],
        );
        // Return at the original issue cost when known, else the current weighted-average.
        await this.postLedger(m, {
          productId: l.productId, warehouseId, docType: 'MRN', docId: mrn.id as string, docNo: mrnNo,
          qtyIn: l.qty, unitCostMinor: l.unitCostMinor || undefined, occurredOn: dto.returnedOn, narration: `MRN ${mrnNo}`,
        });
        if (l.issueItemId) await m.query(`UPDATE inventory_issue_item SET returned_qty = returned_qty + $1, updated_at=now() WHERE id=$2`, [l.qty, l.issueItemId]);
      }
      return { id: mrn.id, mrnNo, status: mrn.status, lines: lines.length };
    });
  }

  // ── Document registers (lists) ──────────────────────────────────────────────
  async listGrns() {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT g.id, g.grn_no, g.status, g.received_on::text AS received_on, po.po_no, v.name AS vendor, w.name AS warehouse,
                COALESCE(SUM(gi.qty),0)::int AS qty, COALESCE(SUM(gi.qty * gi.unit_cost_minor),0)::bigint AS value_minor
         FROM inventory_grn g
         LEFT JOIN inventory_purchase_order po ON po.id = g.po_id
         LEFT JOIN vendor v ON v.id = g.vendor_id
         LEFT JOIN inventory_warehouse w ON w.id = g.warehouse_id
         LEFT JOIN inventory_grn_item gi ON gi.grn_id = g.id
         WHERE g.deleted_at IS NULL GROUP BY g.id, po.po_no, v.name, w.name ORDER BY g.created_at DESC`,
      ),
    );
  }

  async listIssues() {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT i.id, i.issue_no, i.status, i.issued_on::text AS issued_on, i.issued_to, i.department, r.req_no, w.name AS warehouse,
                COALESCE(SUM(ii.qty),0)::int AS qty, COALESCE(SUM(ii.qty * ii.unit_cost_minor),0)::bigint AS value_minor
         FROM inventory_issue i
         LEFT JOIN inventory_requisition r ON r.id = i.requisition_id
         LEFT JOIN inventory_warehouse w ON w.id = i.warehouse_id
         LEFT JOIN inventory_issue_item ii ON ii.issue_id = i.id
         WHERE i.deleted_at IS NULL GROUP BY i.id, r.req_no, w.name ORDER BY i.created_at DESC`,
      ),
    );
  }

  async listMrns() {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT n.id, n.mrn_no, n.status, n.returned_on::text AS returned_on, n.returned_by, i.issue_no, w.name AS warehouse,
                COALESCE(SUM(ni.qty),0)::int AS qty, COALESCE(SUM(ni.qty * ni.unit_cost_minor),0)::bigint AS value_minor
         FROM inventory_mrn n
         LEFT JOIN inventory_issue i ON i.id = n.issue_id
         LEFT JOIN inventory_warehouse w ON w.id = n.warehouse_id
         LEFT JOIN inventory_mrn_item ni ON ni.mrn_id = n.id
         WHERE n.deleted_at IS NULL GROUP BY n.id, i.issue_no, w.name ORDER BY n.created_at DESC`,
      ),
    );
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  private async insertItems(m: Mgr, table: string, fk: string, parentId: string, rows: Array<[string, number]>) {
    for (const [productId, qty] of rows) {
      try {
        await m.query(
          `INSERT INTO ${table} (tenant_id, ${fk}, product_id, qty) VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3)`,
          [parentId, productId, qty],
        );
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('One or more products do not exist in this tenant');
        throw err;
      }
    }
  }

  private async insertPoItems(m: Mgr, poId: string, items: Array<{ productId: string; qty: number; unitPriceMinor?: number }>) {
    for (const i of items) {
      try {
        await m.query(
          `INSERT INTO inventory_po_item (tenant_id, po_id, product_id, qty, unit_price_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)`,
          [poId, i.productId, i.qty, i.unitPriceMinor ?? 0],
        );
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('One or more products do not exist in this tenant');
        throw err;
      }
    }
  }
}

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isForeignKey = (e: unknown) => code(e) === '23503';
const isCheck = (e: unknown) => code(e) === '23514';
