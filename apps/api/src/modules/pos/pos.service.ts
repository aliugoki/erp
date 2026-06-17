import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES, type PosSaleCompletedV1 } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { InventoryDocsService } from '../inventory/inventory-docs.service';
import { OutboxService } from '../outbox/outbox.service';
import { type FetchedAttachment, StorageService, type UploadedFileLike } from '../storage/storage.service';
import { PaymentTerminalService } from './payment-terminal.service';
import type { TerminalChargeDto } from './dto/pos.dto';
import type {
  CloseShiftDto,
  CompleteSaleDto,
  CreateRegisterDto,
  CreateSaleDto,
  OpenShiftDto,
  PosPaymentDto,
  RefundSaleDto,
  UpdateRegisterDto,
} from './dto/pos.dto';
import {
  type PosGlAccounts,
  type PosLineInput,
  changeMinor,
  computeSaleTotals,
  expectedCashMinor,
  mapPayment,
  mapRegister,
  mapSale,
  mapSaleLine,
  mapShift,
  nextPosDocNo,
  varianceMinor,
} from './pos.util';

type Row = Record<string, unknown>;
type Mgr = EntityManager;

const REG_COLS = 'id, name, code, warehouse_id, location, status, currency, card_terminal_provider, card_terminal_url';
const SHIFT_COLS =
  'id, shift_no, register_id, cashier_id, status, opened_at, closed_at, opening_float_minor, counted_cash_minor, expected_cash_minor, variance_minor, currency, notes';
const SALE_COLS =
  'id, sale_no, register_id, shift_id, client_id, customer_name, type, original_sale_id, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, change_minor, cogs_minor, refunded_minor, sold_at, notes';
const LINE_COLS =
  'id, product_id, description, quantity, unit_price_minor, discount_minor, tax_rate, tax_minor, line_total_minor, unit_cost_minor, returned_qty';

/**
 * Point of Sale. Registers host cashier shifts (cash reconciliation on close); a sale rings up priced
 * lines, decrements stock through the inventory valued ledger (capturing COGS), settles with one or
 * more tenders, and emits `pos.sale_completed` via the outbox. Sales can be parked, voided, or
 * refunded (a RETURN sale that restocks and points back at the original). Raw SQL via the
 * tenant-scoped tx (RLS); money is integer minor units.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly inventoryDocs: InventoryDocsService,
    private readonly outbox: OutboxService,
    private readonly terminal: PaymentTerminalService,
    private readonly storage: StorageService,
  ) {}

  // ── Receipt branding ──────────────────────────────────────────────────────────
  async getBranding() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT store_name, address, phone, receipt_footer, logo_attachment_id FROM pos_branding WHERE deleted_at IS NULL LIMIT 1`,
      )) as Row[];
      const r = rows[0] ?? {};
      return {
        storeName: (r.store_name as string) ?? null,
        address: (r.address as string) ?? null,
        phone: (r.phone as string) ?? null,
        receiptFooter: (r.receipt_footer as string) ?? null,
        hasLogo: !!r.logo_attachment_id,
      };
    });
  }

  async setBranding(dto: { storeName?: string; address?: string; phone?: string; receiptFooter?: string }) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO pos_branding (tenant_id, store_name, address, phone, receipt_footer)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)
         ON CONFLICT (tenant_id) DO UPDATE SET store_name=EXCLUDED.store_name, address=EXCLUDED.address,
           phone=EXCLUDED.phone, receipt_footer=EXCLUDED.receipt_footer, updated_at=now()
         RETURNING store_name, address, phone, receipt_footer, logo_attachment_id`,
        [dto.storeName ?? null, dto.address ?? null, dto.phone ?? null, dto.receiptFooter ?? null],
      )) as Row[];
      const r = rows[0] ?? {};
      return {
        storeName: (r.store_name as string) ?? null,
        address: (r.address as string) ?? null,
        phone: (r.phone as string) ?? null,
        receiptFooter: (r.receipt_footer as string) ?? null,
        hasLogo: !!r.logo_attachment_id,
      };
    });
  }

  async uploadLogo(file: UploadedFileLike) {
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('Logo must be an image');
    return this.tenantTx.run(async (m) => {
      const prev = (await m.query(`SELECT logo_attachment_id FROM pos_branding WHERE deleted_at IS NULL LIMIT 1`, [])) as Array<{ logo_attachment_id: string | null }>;
      const { id: attachmentId } = await this.storage.putInTx(m, 'pos.logo', file);
      await m.query(
        `INSERT INTO pos_branding (tenant_id, logo_attachment_id) VALUES (current_setting('app.tenant_id')::uuid, $1)
         ON CONFLICT (tenant_id) DO UPDATE SET logo_attachment_id=EXCLUDED.logo_attachment_id, updated_at=now()`,
        [attachmentId],
      );
      const old = prev[0]?.logo_attachment_id;
      if (old) await m.query(`UPDATE app_attachment SET deleted_at=now() WHERE id=$1`, [old]);
      return { hasLogo: true };
    });
  }

  async getLogo(): Promise<FetchedAttachment | null> {
    const attachmentId = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT logo_attachment_id FROM pos_branding WHERE deleted_at IS NULL LIMIT 1`, [])) as Array<{ logo_attachment_id: string | null }>;
      return rows[0]?.logo_attachment_id ?? null;
    });
    if (!attachmentId) return null;
    return this.storage.get(attachmentId, 'pos.logo');
  }

  /** Initiate a card charge on the register's configured terminal. The cashier then records the
   * returned reference/scheme as a CARD tender on the sale. Does not itself create a sale. */
  async chargeCard(registerId: string, dto: TerminalChargeDto) {
    const reg = await this.tenantTx.run((m) => this.getRegisterWith(m, registerId));
    const reference = dto.reference ?? `CHG-${randomBytes(4).toString('hex').toUpperCase()}`;
    return this.terminal.charge(reg, { amountMinor: dto.amountMinor, reference });
  }

  // ── Registers ───────────────────────────────────────────────────────────────
  async createRegister(dto: CreateRegisterDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO pos_register (tenant_id, name, code, warehouse_id, location, currency, card_terminal_provider, card_terminal_url)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4, COALESCE($5,'PKR'), COALESCE($6,'NONE'), $7) RETURNING ${REG_COLS}`,
          [dto.name, dto.code ?? null, dto.warehouseId ?? null, dto.location ?? null, dto.currency ?? null,
            dto.cardTerminalProvider ?? null, dto.cardTerminalUrl ?? null],
        )) as Row[];
        return mapRegister(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown warehouse for this tenant');
        throw err;
      }
    });
  }

  async listRegisters() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${REG_COLS} FROM pos_register WHERE deleted_at IS NULL ORDER BY created_at`,
      )) as Row[];
      return rows.map(mapRegister);
    });
  }

  async getRegister(id: string) {
    return this.tenantTx.run((m) => this.getRegisterWith(m, id));
  }

  async updateRegister(id: string, dto: UpdateRegisterDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, val: unknown) => {
        sets.push(`${col}=$${params.length + 1}`);
        params.push(val);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.code !== undefined) set('code', dto.code);
      if (dto.warehouseId !== undefined) set('warehouse_id', dto.warehouseId);
      if (dto.location !== undefined) set('location', dto.location);
      if (dto.status !== undefined) set('status', dto.status);
      if (dto.cardTerminalProvider !== undefined) set('card_terminal_provider', dto.cardTerminalProvider);
      if (dto.cardTerminalUrl !== undefined) set('card_terminal_url', dto.cardTerminalUrl);
      if (sets.length === 0) return this.getRegisterWith(m, id);
      const rows = rowsOf(
        await m.query(
          `UPDATE pos_register SET ${sets.join(', ')}, updated_at=now()
           WHERE id=$1 AND deleted_at IS NULL RETURNING ${REG_COLS}`,
          params,
        ),
      ) as Row[];
      if (!rows[0]) throw new NotFoundException('Register not found');
      return mapRegister(rows[0]);
    });
  }

  async deleteRegister(id: string) {
    await this.tenantTx.run(async (m) => {
      const open = (await m.query(
        `SELECT 1 FROM pos_shift WHERE register_id=$1 AND status='OPEN' AND deleted_at IS NULL LIMIT 1`,
        [id],
      )) as Row[];
      if (open[0]) throw new ConflictException('Register has an open shift; close it first');
      const rows = rowsOf(
        await m.query(`UPDATE pos_register SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]),
      ) as Row[];
      if (!rows[0]) throw new NotFoundException('Register not found');
    });
  }

  // ── Shifts ──────────────────────────────────────────────────────────────────
  async openShift(dto: OpenShiftDto, cashierId: string | null) {
    return this.tenantTx.run(async (m) => {
      const reg = await this.getRegisterWith(m, dto.registerId);
      if (reg.status !== 'ACTIVE') throw new UnprocessableEntityException('Register is not active');
      const shiftNo = await nextPosDocNo(m, 'SHIFT', 'SHIFT');
      try {
        const rows = (await m.query(
          `INSERT INTO pos_shift (tenant_id, shift_no, register_id, cashier_id, opening_float_minor, currency, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6) RETURNING ${SHIFT_COLS}`,
          [shiftNo, dto.registerId, cashierId, dto.openingFloatMinor ?? 0, reg.currency, dto.notes ?? null],
        )) as Row[];
        return mapShift(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new ConflictException('Register already has an open shift');
        throw err;
      }
    });
  }

  async closeShift(id: string, dto: CloseShiftDto) {
    return this.tenantTx.run(async (m) => {
      const sRows = (await m.query(
        `SELECT ${SHIFT_COLS} FROM pos_shift WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )) as Row[];
      const shift = sRows[0];
      if (!shift) throw new NotFoundException('Shift not found');
      if (shift.status !== 'OPEN') throw new UnprocessableEntityException('Shift is already closed');

      const cash = await this.shiftCashFlow(m, id);
      const expected = expectedCashMinor(
        Number(shift.opening_float_minor),
        cash.cashSalesIn,
        cash.changeOut + cash.cashRefundOut,
      );
      const variance = varianceMinor(dto.countedCashMinor, expected);
      const rows = rowsOf(
        await m.query(
          `UPDATE pos_shift SET status='CLOSED', closed_at=now(), counted_cash_minor=$2,
             expected_cash_minor=$3, variance_minor=$4, notes=COALESCE($5, notes), updated_at=now()
           WHERE id=$1 RETURNING ${SHIFT_COLS}`,
          [id, dto.countedCashMinor, expected, variance, dto.notes ?? null],
        ),
      ) as Row[];
      return { ...mapShift(rows[0]!), report: await this.buildShiftReport(m, id) };
    });
  }

  async getShift(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${SHIFT_COLS} FROM pos_shift WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      if (!rows[0]) throw new NotFoundException('Shift not found');
      return { ...mapShift(rows[0]), report: await this.buildShiftReport(m, id) };
    });
  }

  async listShifts(registerId?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${SHIFT_COLS} FROM pos_shift WHERE deleted_at IS NULL ${registerId ? 'AND register_id=$1' : ''}
         ORDER BY opened_at DESC LIMIT 200`,
        registerId ? [registerId] : [],
      )) as Row[];
      return rows.map(mapShift);
    });
  }

  /** The currently OPEN shift for a register, or null. */
  async currentShift(registerId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${SHIFT_COLS} FROM pos_shift WHERE register_id=$1 AND status='OPEN' AND deleted_at IS NULL`,
        [registerId],
      )) as Row[];
      return rows[0] ? mapShift(rows[0]) : null;
    });
  }

  // ── Sales ─────────────────────────────────────────────────────────────────────
  async createSale(dto: CreateSaleDto, userId: string | null) {
    return this.tenantTx.run(async (m) => {
      const shift = await this.assertOpenShift(m, dto.shiftId, dto.registerId);
      const reg = await this.getRegisterWith(m, dto.registerId);
      const lines = dto.lines as PosLineInput[];
      const totals = computeSaleTotals(lines, dto.orderDiscountMinor ?? 0);

      if (dto.park) {
        const saleNo = await nextPosDocNo(m, 'PARK', 'PARK');
        const id = await this.insertSale(m, {
          saleNo, dto, reg, shift, totals, status: 'PARKED', type: 'SALE',
          paidMinor: 0, changeMinor: 0, cogsMinor: 0, userId, originalSaleId: null,
        });
        await this.insertLines(m, id, lines, /*withCost*/ false);
        return this.getSaleWith(m, id);
      }

      const payments = dto.payments ?? [];
      const paid = payments.reduce((s, p) => s + p.amountMinor, 0);
      if (paid < totals.totalMinor) {
        throw new UnprocessableEntityException(`Insufficient tender: paid ${paid}, total ${totals.totalMinor}`);
      }
      const saleNo = await nextPosDocNo(m, 'SALE', 'SALE');
      const id = await this.insertSale(m, {
        saleNo, dto, reg, shift, totals, status: 'COMPLETED', type: 'SALE',
        paidMinor: paid, changeMinor: changeMinor(paid, totals.totalMinor), cogsMinor: 0, userId, originalSaleId: null,
      });
      const cogs = await this.insertLines(m, id, lines, /*withCost*/ true, reg.warehouseId, saleNo);
      await m.query(`UPDATE pos_sale SET cogs_minor=$2 WHERE id=$1`, [id, cogs]);
      await this.insertPayments(m, id, payments);
      await this.emitSaleCompleted(m, id, saleNo, dto.registerId, dto.shiftId, dto.clientId ?? null, 'SALE',
        totals.totalMinor, cogs, reg.currency, lines.length);
      return this.getSaleWith(m, id);
    });
  }

  /** Settle a PARKED sale: decrement stock, record tenders, mark COMPLETED. */
  async completeParkedSale(id: string, dto: CompleteSaleDto, userId: string | null) {
    return this.tenantTx.run(async (m) => {
      const sale = (await m.query(`SELECT ${SALE_COLS} FROM pos_sale WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
      const s = sale[0];
      if (!s) throw new NotFoundException('Sale not found');
      if (s.status !== 'PARKED') throw new UnprocessableEntityException('Sale is not parked');
      await this.assertOpenShift(m, s.shift_id as string, s.register_id as string);
      const reg = await this.getRegisterWith(m, s.register_id as string);

      const paid = dto.payments.reduce((sum, p) => sum + p.amountMinor, 0);
      const total = Number(s.total_minor);
      if (paid < total) throw new UnprocessableEntityException(`Insufficient tender: paid ${paid}, total ${total}`);

      const lineRows = (await m.query(`SELECT ${LINE_COLS} FROM pos_sale_line WHERE sale_id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      let cogs = 0;
      const saleNo = s.sale_no as string;
      for (const l of lineRows) {
        if (l.product_id) {
          const res = await this.inventoryDocs.applyStockMovement(m, {
            productId: l.product_id as string,
            warehouseId: reg.warehouseId,
            docType: 'POS_SALE',
            docId: id,
            docNo: saleNo,
            qtyOut: Number(l.quantity),
            narration: `POS sale ${saleNo}`,
          });
          const cost = res.unitCostMinor * Number(l.quantity);
          cogs += cost;
          await m.query(`UPDATE pos_sale_line SET unit_cost_minor=$2 WHERE id=$1`, [l.id, res.unitCostMinor]);
        }
      }
      await m.query(
        `UPDATE pos_sale SET status='COMPLETED', paid_minor=$2, change_minor=$3, cogs_minor=$4, sold_at=now(), sold_by=$5, updated_at=now() WHERE id=$1`,
        [id, paid, changeMinor(paid, total), cogs, userId],
      );
      await this.insertPayments(m, id, dto.payments);
      await this.emitSaleCompleted(m, id, saleNo, s.register_id as string, s.shift_id as string,
        (s.client_id as string) ?? null, 'SALE', total, cogs, reg.currency, lineRows.length);
      return this.getSaleWith(m, id);
    });
  }

  async getSale(id: string) {
    return this.tenantTx.run((m) => this.getSaleWith(m, id));
  }

  async listSales(query: { shiftId?: string; registerId?: string }) {
    return this.tenantTx.run(async (m) => {
      const where: string[] = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.shiftId) where.push(`shift_id=$${params.push(query.shiftId)}`);
      if (query.registerId) where.push(`register_id=$${params.push(query.registerId)}`);
      const rows = (await m.query(
        `SELECT ${SALE_COLS} FROM pos_sale WHERE ${where.join(' AND ')} ORDER BY sold_at DESC LIMIT 200`,
        params,
      )) as Row[];
      return rows.map(mapSale);
    });
  }

  /** Void a completed sale within its (still-open) shift: restock everything, mark VOIDED. */
  async voidSale(id: string, userId: string | null) {
    return this.tenantTx.run(async (m) => {
      const sRows = (await m.query(`SELECT ${SALE_COLS} FROM pos_sale WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
      const s = sRows[0];
      if (!s) throw new NotFoundException('Sale not found');
      if (s.type !== 'SALE') throw new UnprocessableEntityException('Only a sale can be voided');
      if (s.status !== 'COMPLETED') throw new UnprocessableEntityException(`Cannot void a ${String(s.status)} sale`);
      await this.assertOpenShift(m, s.shift_id as string, s.register_id as string);
      const reg = await this.getRegisterWith(m, s.register_id as string);

      const lineRows = (await m.query(`SELECT ${LINE_COLS} FROM pos_sale_line WHERE sale_id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      for (const l of lineRows) {
        if (l.product_id) {
          await this.inventoryDocs.applyStockMovement(m, {
            productId: l.product_id as string,
            warehouseId: reg.warehouseId,
            docType: 'POS_VOID',
            docId: id,
            docNo: s.sale_no as string,
            qtyIn: Number(l.quantity),
            unitCostMinor: Number(l.unit_cost_minor),
            narration: `Void POS sale ${String(s.sale_no)}`,
          });
        }
      }
      await m.query(`UPDATE pos_sale SET status='VOIDED', sold_by=COALESCE($2, sold_by), updated_at=now() WHERE id=$1`, [id, userId]);
      return this.getSaleWith(m, id);
    });
  }

  /** Refund all or part of a completed sale: a RETURN sale restocks the returned units and pays cash back. */
  async refundSale(id: string, dto: RefundSaleDto, userId: string | null) {
    return this.tenantTx.run(async (m) => {
      const sRows = (await m.query(`SELECT ${SALE_COLS} FROM pos_sale WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
      const orig = sRows[0];
      if (!orig) throw new NotFoundException('Sale not found');
      if (orig.type !== 'SALE') throw new UnprocessableEntityException('Only a sale can be refunded');
      if (!['COMPLETED', 'PARTIALLY_REFUNDED'].includes(orig.status as string)) {
        throw new UnprocessableEntityException(`Cannot refund a ${String(orig.status)} sale`);
      }
      const reg = await this.getRegisterWith(m, orig.register_id as string);
      await this.assertOpenShift(m, orig.shift_id as string, orig.register_id as string);

      const lineRows = (await m.query(`SELECT ${LINE_COLS} FROM pos_sale_line WHERE sale_id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      const byId = new Map(lineRows.map((l) => [l.id as string, l]));
      // Resolve which (line, qty) pairs to refund.
      const requests = dto.lines?.length
        ? dto.lines.map((r) => ({ line: byId.get(r.lineId), qty: r.quantity }))
        : lineRows.map((l) => ({ line: l, qty: Number(l.quantity) - Number(l.returned_qty) }));

      let refundTotal = 0;
      let refundCogs = 0;
      const refundLines: { line: Row; qty: number; amountMinor: number }[] = [];
      for (const req of requests) {
        const l = req.line;
        if (!l) throw new BadRequestException('Refund line does not belong to this sale');
        const remaining = Number(l.quantity) - Number(l.returned_qty);
        if (req.qty <= 0) continue;
        if (req.qty > remaining) throw new UnprocessableEntityException(`Refund qty ${req.qty} exceeds remaining ${remaining}`);
        // Pro-rate the line's net total across its units.
        const perUnit = Math.round(Number(l.line_total_minor) / Number(l.quantity));
        const amount = perUnit * req.qty;
        refundTotal += amount;
        refundCogs += Number(l.unit_cost_minor) * req.qty;
        refundLines.push({ line: l, qty: req.qty, amountMinor: amount });
      }
      if (refundLines.length === 0) throw new BadRequestException('Nothing to refund');

      const saleNo = await nextPosDocNo(m, 'RET', 'RET');
      const retRows = (await m.query(
        `INSERT INTO pos_sale (tenant_id, sale_no, register_id, shift_id, client_id, customer_name, type, original_sale_id,
           status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, change_minor, cogs_minor, sold_by, notes)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,'RETURN',$6,'COMPLETED',$7,$8,0,0,$8,$8,0,$9,$10,$11)
         RETURNING id`,
        [saleNo, orig.register_id, orig.shift_id, orig.client_id ?? null, orig.customer_name ?? null, id,
          reg.currency, refundTotal, refundCogs, userId, dto.reason ?? null],
      )) as Row[];
      const retId = retRows[0]!.id as string;

      for (const rl of refundLines) {
        const l = rl.line;
        await m.query(
          `INSERT INTO pos_sale_line (tenant_id, sale_id, product_id, description, quantity, unit_price_minor,
             discount_minor, tax_rate, tax_minor, line_total_minor, unit_cost_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,0,$6,0,$7,$8)`,
          [retId, l.product_id ?? null, l.description, rl.qty, l.unit_price_minor, l.tax_rate, rl.amountMinor, l.unit_cost_minor],
        );
        if (l.product_id) {
          await this.inventoryDocs.applyStockMovement(m, {
            productId: l.product_id as string,
            warehouseId: reg.warehouseId,
            docType: 'POS_RETURN',
            docId: retId,
            docNo: saleNo,
            qtyIn: rl.qty,
            unitCostMinor: Number(l.unit_cost_minor),
            narration: `POS return ${saleNo} of ${String(orig.sale_no)}`,
          });
        }
        await m.query(`UPDATE pos_sale_line SET returned_qty=returned_qty+$2, updated_at=now() WHERE id=$1`, [l.id, rl.qty]);
      }
      await this.insertPayments(m, retId, [{ method: dto.method ?? 'CASH', amountMinor: refundTotal }]);

      // Update the original sale's refunded total + status.
      const fullyReturned = await this.isFullyReturned(m, id);
      await m.query(
        `UPDATE pos_sale SET refunded_minor=refunded_minor+$2, status=$3, updated_at=now() WHERE id=$1`,
        [id, refundTotal, fullyReturned ? 'REFUNDED' : 'PARTIALLY_REFUNDED'],
      );

      await this.emitSaleCompleted(m, retId, saleNo, orig.register_id as string, orig.shift_id as string,
        (orig.client_id as string) ?? null, 'RETURN', refundTotal, refundCogs, reg.currency, refundLines.length);
      return this.getSaleWith(m, retId);
    });
  }

  // ── Reports ───────────────────────────────────────────────────────────────────
  /** Daily sales summary for a date (defaults to today): gross sales, refunds, net, tender mix. */
  async dailySummary(date?: string) {
    return this.tenantTx.run(async (m) => {
      const day = date ?? null;
      const totals = (await m.query(
        `SELECT
           COUNT(*) FILTER (WHERE type='SALE') AS sale_count,
           COUNT(*) FILTER (WHERE type='RETURN') AS return_count,
           COALESCE(SUM(total_minor) FILTER (WHERE type='SALE'),0) AS gross_minor,
           COALESCE(SUM(total_minor) FILTER (WHERE type='RETURN'),0) AS refund_minor,
           COALESCE(SUM(cogs_minor) FILTER (WHERE type='SALE'),0) AS cogs_minor
         FROM pos_sale
         WHERE status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') AND deleted_at IS NULL
           AND sold_at::date = COALESCE($1::date, current_date)`,
        [day],
      )) as Row[];
      const tenders = (await m.query(
        `SELECT p.method, COALESCE(SUM(p.amount_minor),0) AS amount_minor
         FROM pos_payment p JOIN pos_sale s ON s.id = p.sale_id
         WHERE s.deleted_at IS NULL AND s.type='SALE' AND s.sold_at::date = COALESCE($1::date, current_date)
         GROUP BY p.method ORDER BY p.method`,
        [day],
      )) as Row[];
      const t = totals[0]!;
      const gross = Number(t.gross_minor);
      const refund = Number(t.refund_minor);
      const cogs = Number(t.cogs_minor);
      return {
        date: day,
        saleCount: Number(t.sale_count),
        returnCount: Number(t.return_count),
        grossSalesMinor: gross,
        refundsMinor: refund,
        netSalesMinor: gross - refund,
        cogsMinor: cogs,
        grossMarginMinor: gross - refund - cogs,
        tenders: tenders.map((r) => ({ method: r.method as string, amountMinor: Number(r.amount_minor) })),
      };
    });
  }

  /** Top-selling products over an optional date range. */
  async topProducts(limit = 10) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT l.product_id, MIN(l.description) AS description,
           SUM(l.quantity) AS qty, SUM(l.line_total_minor) AS revenue_minor
         FROM pos_sale_line l JOIN pos_sale s ON s.id = l.sale_id
         WHERE s.type='SALE' AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
           AND l.deleted_at IS NULL AND l.product_id IS NOT NULL
         GROUP BY l.product_id ORDER BY qty DESC LIMIT $1`,
        [Math.min(Math.max(limit, 1), 100)],
      )) as Row[];
      return rows.map((r) => ({
        productId: r.product_id as string,
        description: r.description as string,
        quantity: Number(r.qty),
        revenueMinor: Number(r.revenue_minor),
      }));
    });
  }

  // ── GL posting config ─────────────────────────────────────────────────────────
  async getGlConfig(): Promise<PosGlAccounts> {
    return this.tenantTx.run((m) => this.glConfigInTx(m));
  }

  async setGlConfig(dto: Partial<Record<keyof PosGlAccounts, string>>): Promise<PosGlAccounts> {
    return this.tenantTx.run(async (m) => {
      try {
        await m.query(
          `INSERT INTO pos_gl_config (tenant_id, clearing_account_id, revenue_account_id, tax_account_id, cogs_account_id, inventory_account_id)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id) DO UPDATE SET clearing_account_id=EXCLUDED.clearing_account_id, revenue_account_id=EXCLUDED.revenue_account_id,
             tax_account_id=EXCLUDED.tax_account_id, cogs_account_id=EXCLUDED.cogs_account_id, inventory_account_id=EXCLUDED.inventory_account_id, updated_at=now()`,
          [dto.clearingAccountId ?? null, dto.revenueAccountId ?? null, dto.taxAccountId ?? null, dto.cogsAccountId ?? null, dto.inventoryAccountId ?? null],
        );
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown finance account for this tenant');
        throw err;
      }
      return this.glConfigInTx(m);
    });
  }

  /** Read the POS GL config inside an existing tenant transaction (used by the GL consumer). */
  async glConfigInTx(m: Mgr): Promise<PosGlAccounts> {
    const rows = (await m.query(
      `SELECT clearing_account_id, revenue_account_id, tax_account_id, cogs_account_id, inventory_account_id
       FROM pos_gl_config WHERE deleted_at IS NULL LIMIT 1`,
    )) as Row[];
    const r = rows[0] ?? {};
    return {
      clearingAccountId: (r.clearing_account_id as string) ?? null,
      revenueAccountId: (r.revenue_account_id as string) ?? null,
      taxAccountId: (r.tax_account_id as string) ?? null,
      cogsAccountId: (r.cogs_account_id as string) ?? null,
      inventoryAccountId: (r.inventory_account_id as string) ?? null,
    };
  }

  /** A completed sale's GL-relevant figures, read inside the consumer's tenant transaction. */
  async saleForGlInTx(m: Mgr, saleId: string): Promise<{ saleNo: string; type: 'SALE' | 'RETURN'; totalMinor: number; taxMinor: number; cogsMinor: number; occurredOn: string } | null> {
    const rows = (await m.query(
      `SELECT sale_no, type, total_minor, tax_minor, cogs_minor, sold_at FROM pos_sale WHERE id=$1 AND deleted_at IS NULL`,
      [saleId],
    )) as Row[];
    const r = rows[0];
    if (!r) return null;
    const soldAt = r.sold_at;
    const occurredOn = soldAt instanceof Date ? soldAt.toISOString().slice(0, 10) : String(soldAt).slice(0, 10);
    return {
      saleNo: r.sale_no as string,
      type: r.type as 'SALE' | 'RETURN',
      totalMinor: Number(r.total_minor),
      taxMinor: Number(r.tax_minor),
      cogsMinor: Number(r.cogs_minor),
      occurredOn,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  private async getRegisterWith(m: Mgr, id: string) {
    const rows = (await m.query(`SELECT ${REG_COLS} FROM pos_register WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Register not found');
    return mapRegister(rows[0]);
  }

  private async assertOpenShift(m: Mgr, shiftId: string, registerId: string) {
    const rows = (await m.query(
      `SELECT ${SHIFT_COLS} FROM pos_shift WHERE id=$1 AND deleted_at IS NULL`,
      [shiftId],
    )) as Row[];
    const shift = rows[0];
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.register_id !== registerId) throw new BadRequestException('Shift does not belong to this register');
    if (shift.status !== 'OPEN') throw new UnprocessableEntityException('Shift is closed');
    return mapShift(shift);
  }

  private async insertSale(
    m: Mgr,
    p: {
      saleNo: string;
      dto: CreateSaleDto;
      reg: ReturnType<typeof mapRegister>;
      shift: ReturnType<typeof mapShift>;
      totals: ReturnType<typeof computeSaleTotals>;
      status: string;
      type: string;
      paidMinor: number;
      changeMinor: number;
      cogsMinor: number;
      userId: string | null;
      originalSaleId: string | null;
    },
  ): Promise<string> {
    try {
      const rows = (await m.query(
        `INSERT INTO pos_sale (tenant_id, sale_no, register_id, shift_id, client_id, customer_name, type, original_sale_id,
           status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, change_minor, cogs_minor, sold_by, notes)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING id`,
        [
          p.saleNo, p.dto.registerId, p.dto.shiftId, p.dto.clientId ?? null, p.dto.customerName ?? null, p.type,
          p.originalSaleId, p.status, p.reg.currency, p.totals.subtotalMinor, p.totals.discountMinor, p.totals.taxMinor,
          p.totals.totalMinor, p.paidMinor, p.changeMinor, p.cogsMinor, p.userId, p.dto.notes ?? null,
        ],
      )) as Row[];
      return rows[0]!.id as string;
    } catch (err) {
      if (isFk(err)) throw new BadRequestException('Unknown client for this tenant');
      throw err;
    }
  }

  /** Insert sale lines. When `withCost`, decrements stock per line and returns accumulated COGS. */
  private async insertLines(
    m: Mgr,
    saleId: string,
    lines: PosLineInput[],
    withCost: boolean,
    warehouseId?: string | null,
    saleNo?: string,
  ): Promise<number> {
    let cogs = 0;
    for (const line of lines) {
      let unitCost = 0;
      if (withCost && line.productId) {
        const res = await this.inventoryDocs.applyStockMovement(m, {
          productId: line.productId,
          warehouseId: warehouseId ?? null,
          docType: 'POS_SALE',
          docId: saleId,
          docNo: saleNo ?? null,
          qtyOut: line.quantity,
          narration: `POS sale ${saleNo ?? ''}`.trim(),
        });
        unitCost = res.unitCostMinor;
        cogs += unitCost * line.quantity;
      }
      const gross = line.quantity * line.unitPriceMinor;
      const discount = Math.min(Math.max(line.discountMinor ?? 0, 0), gross);
      const taxable = gross - discount;
      const tax = Math.floor((taxable * (line.taxRate ?? 0)) / 100);
      await m.query(
        `INSERT INTO pos_sale_line (tenant_id, sale_id, product_id, description, quantity, unit_price_minor,
           discount_minor, tax_rate, tax_minor, line_total_minor, unit_cost_minor)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [saleId, line.productId ?? null, line.description, line.quantity, line.unitPriceMinor,
          discount, line.taxRate ?? 0, tax, taxable + tax, unitCost],
      );
    }
    return cogs;
  }

  private async insertPayments(m: Mgr, saleId: string, payments: Array<Partial<PosPaymentDto> & { method: string; amountMinor: number }>) {
    for (const pay of payments) {
      await m.query(
        `INSERT INTO pos_payment (tenant_id, sale_id, method, amount_minor, reference, card_scheme, card_last4)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6)`,
        [saleId, pay.method, pay.amountMinor, pay.reference ?? null, pay.cardScheme ?? null, pay.cardLast4 ?? null],
      );
    }
  }

  private async isFullyReturned(m: Mgr, saleId: string): Promise<boolean> {
    const rows = (await m.query(
      `SELECT COALESCE(SUM(quantity - returned_qty),0) AS remaining FROM pos_sale_line WHERE sale_id=$1 AND deleted_at IS NULL`,
      [saleId],
    )) as Row[];
    return Number(rows[0]!.remaining) <= 0;
  }

  /** Cash flows within a shift, for the close-out reconciliation. */
  private async shiftCashFlow(m: Mgr, shiftId: string): Promise<{ cashSalesIn: number; changeOut: number; cashRefundOut: number }> {
    const cashIn = (await m.query(
      `SELECT COALESCE(SUM(p.amount_minor),0) AS v FROM pos_payment p JOIN pos_sale s ON s.id=p.sale_id
       WHERE s.shift_id=$1 AND s.type='SALE' AND p.method='CASH' AND s.deleted_at IS NULL`,
      [shiftId],
    )) as Row[];
    const changeOut = (await m.query(
      `SELECT COALESCE(SUM(change_minor),0) AS v FROM pos_sale WHERE shift_id=$1 AND type='SALE' AND deleted_at IS NULL`,
      [shiftId],
    )) as Row[];
    const refundOut = (await m.query(
      `SELECT COALESCE(SUM(p.amount_minor),0) AS v FROM pos_payment p JOIN pos_sale s ON s.id=p.sale_id
       WHERE s.shift_id=$1 AND s.type='RETURN' AND p.method='CASH' AND s.deleted_at IS NULL`,
      [shiftId],
    )) as Row[];
    return {
      cashSalesIn: Number(cashIn[0]!.v),
      changeOut: Number(changeOut[0]!.v),
      cashRefundOut: Number(refundOut[0]!.v),
    };
  }

  /** X report (shift still open) / Z report (closed): totals + tender mix for the session. */
  private async buildShiftReport(m: Mgr, shiftId: string) {
    const totals = (await m.query(
      `SELECT
         COUNT(*) FILTER (WHERE type='SALE') AS sale_count,
         COUNT(*) FILTER (WHERE type='RETURN') AS return_count,
         COALESCE(SUM(total_minor) FILTER (WHERE type='SALE'),0) AS gross_minor,
         COALESCE(SUM(total_minor) FILTER (WHERE type='RETURN'),0) AS refund_minor
       FROM pos_sale WHERE shift_id=$1 AND status<>'PARKED' AND deleted_at IS NULL`,
      [shiftId],
    )) as Row[];
    const tenders = (await m.query(
      `SELECT p.method,
         COALESCE(SUM(p.amount_minor) FILTER (WHERE s.type='SALE'),0) AS in_minor,
         COALESCE(SUM(p.amount_minor) FILTER (WHERE s.type='RETURN'),0) AS out_minor
       FROM pos_payment p JOIN pos_sale s ON s.id=p.sale_id
       WHERE s.shift_id=$1 AND s.deleted_at IS NULL GROUP BY p.method ORDER BY p.method`,
      [shiftId],
    )) as Row[];
    const cash = await this.shiftCashFlow(m, shiftId);
    const t = totals[0]!;
    return {
      saleCount: Number(t.sale_count),
      returnCount: Number(t.return_count),
      grossSalesMinor: Number(t.gross_minor),
      refundsMinor: Number(t.refund_minor),
      netSalesMinor: Number(t.gross_minor) - Number(t.refund_minor),
      cashSalesMinor: cash.cashSalesIn,
      changeGivenMinor: cash.changeOut,
      cashRefundsMinor: cash.cashRefundOut,
      tenders: tenders.map((r) => ({
        method: r.method as string,
        inMinor: Number(r.in_minor),
        outMinor: Number(r.out_minor),
      })),
    };
  }

  private async emitSaleCompleted(
    m: Mgr, saleId: string, saleNo: string, registerId: string, shiftId: string,
    clientId: string | null, type: 'SALE' | 'RETURN', totalMinor: number, cogsMinor: number, currency: string, lineCount: number,
  ) {
    const payload: PosSaleCompletedV1 = { saleId, saleNo, registerId, shiftId, clientId, type, totalMinor, cogsMinor, currency, lineCount };
    await this.outbox.write(m, EVENT_TYPES.POS_SALE_COMPLETED, payload);
  }

  private async getSaleWith(m: Mgr, id: string) {
    const rows = (await m.query(`SELECT ${SALE_COLS} FROM pos_sale WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Sale not found');
    const currency = rows[0].currency;
    const lines = (await m.query(
      `SELECT ${LINE_COLS} FROM pos_sale_line WHERE sale_id=$1 AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    )) as Row[];
    const payments = (await m.query(
      `SELECT id, method, amount_minor, reference, card_scheme, card_last4, paid_at FROM pos_payment WHERE sale_id=$1 AND deleted_at IS NULL ORDER BY paid_at`,
      [id],
    )) as Row[];
    return {
      ...mapSale(rows[0]),
      lines: lines.map((l) => mapSaleLine(l, currency)),
      payments: payments.map((pp) => mapPayment(pp, currency)),
    };
  }
}

/** TypeORM returns [rows, affectedCount] for UPDATE…RETURNING; normalize to the rows array. */
function rowsOf(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return (res ?? []) as unknown[];
}
const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';
