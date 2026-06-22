import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type { DispenseDto, ReturnDispenseDto } from './dto/pharmacy.dto';
import { PharmacyStockService } from './pharmacy-stock.service';
import { DOC_PREFIX, type Row, computeDispenseLine, formatDocNo, money } from './pharmacy.util';
import type { DispenseForGl } from './pharmacy-gl.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isForeignKey = (e: unknown) => code(e) === '23503';

/**
 * Dispensing & sales — retail counter, prescription, hospital ward issue, wholesale. Each line is
 * priced (qty × price − discount + tax), stock is consumed FEFO (returning weighted-average COGS),
 * controlled/scheduled drugs append to the immutable register, and a `pharmacy.dispense_completed`
 * event is written to the outbox so the GL consumer posts the journal voucher. Returns reverse it.
 */
@Injectable()
export class PharmacyDispenseService {
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

  async createDispense(dto: DispenseDto) {
    const type = dto.type ?? 'RETAIL_SALE';
    return this.tenantTx.run(async (m) => {
      const cfgRows = (await m.query(
        `SELECT controlled_register_enabled, allow_dispense_without_stock, default_tax_bp, currency
         FROM pharmacy_config WHERE deleted_at IS NULL LIMIT 1`,
      )) as Row[];
      const cfg = cfgRows[0];
      const allowShort = cfg ? Boolean(cfg.allow_dispense_without_stock) : false;
      const controlledEnabled = cfg ? Boolean(cfg.controlled_register_enabled) : true;
      const defaultTaxBp = cfg ? Number(cfg.default_tax_bp) : 0;
      const currency = dto.currency ?? (cfg?.currency as string) ?? 'PKR';

      const dispenseNo = await this.nextDocNo(m, 'DSP');
      let header: Row;
      try {
        const rows = (await m.query(
          `INSERT INTO pharmacy_dispense
             (tenant_id, dispense_no, type, customer_id, patient_ref, prescriber, prescription_ref, ward,
              currency, payment_method, insurer, insurance_cover_minor, occurred_on, status, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'CASH'),$10,$11,
                   COALESCE($12::date,current_date),'COMPLETED',$13)
           RETURNING id, dispense_no`,
          [
            dispenseNo, type, dto.customerId ?? null, dto.patientRef ?? null, dto.prescriber ?? null,
            dto.prescriptionRef ?? null, dto.ward ?? null, currency, dto.paymentMethod ?? null,
            dto.insurer ?? null, dto.insuranceCoverMinor ?? 0, dto.occurredOn ?? null, dto.notes ?? null,
          ],
        )) as Row[];
        header = rows[0]!;
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Unknown customer for this tenant');
        throw err;
      }
      const dispenseId = header.id as string;

      let subtotal = 0;
      let discount = 0;
      let tax = 0;
      let total = 0;
      let cogs = 0;

      for (const item of dto.items) {
        const prodRows = (await m.query(
          `SELECT p.sell_price_minor, p.name, d.controlled, d.schedule
           FROM inventory_product p LEFT JOIN pharmacy_drug d ON d.product_id = p.id AND d.deleted_at IS NULL
           WHERE p.id=$1 AND p.deleted_at IS NULL`,
          [item.productId],
        )) as Row[];
        if (!prodRows[0]) throw new BadRequestException('Unknown product for this tenant');
        const prod = prodRows[0];

        const unitPrice = item.unitPriceMinor ?? Number(prod.sell_price_minor);
        const taxBp = item.taxBp ?? defaultTaxBp;
        const line = computeDispenseLine({ qty: item.qty, unitPriceMinor: unitPrice, discountMinor: item.discountMinor, taxBp });

        let cogsMinor = 0;
        let lotId: string | null = null;
        let lotNo: string | null = null;
        let expiry: string | null = null;
        try {
          const consumed = await this.stock.consumeFefoInTx(m, {
            productId: item.productId, qty: item.qty, docType: 'DSP', docId: dispenseId, docNo: dispenseNo, allowShort,
          });
          cogsMinor = consumed.cogsMinor;
          const first = consumed.allocations[0];
          if (first) {
            lotId = first.lotId;
            lotNo = first.lotNo;
            expiry = first.expiryDate;
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'InsufficientStockError') {
            throw new UnprocessableEntityException(`${prod.name as string}: ${err.message}`);
          }
          throw err;
        }

        await m.query(
          `INSERT INTO pharmacy_dispense_item
             (tenant_id, dispense_id, product_id, lot_id, lot_no, expiry_date, qty, unit_price_minor,
              unit_cost_minor, discount_minor, tax_minor, line_total_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11)`,
          [
            dispenseId, item.productId, lotId, lotNo, expiry, item.qty, unitPrice,
            item.qty > 0 ? Math.round(cogsMinor / item.qty) : 0, line.discountMinor, line.taxMinor, line.lineTotalMinor,
          ],
        );

        if (controlledEnabled && Boolean(prod.controlled)) {
          const onHand = (await m.query(`SELECT on_hand FROM inventory_product WHERE id=$1`, [item.productId])) as Row[];
          await m.query(
            `INSERT INTO pharmacy_controlled_register
               (tenant_id, product_id, dispense_id, direction, lot_no, qty, balance_after, schedule, prescriber, patient_ref, prescription_ref, occurred_on)
             VALUES (current_setting('app.tenant_id')::uuid, $1,$2,'OUT',$3,$4,$5,$6,$7,$8,$9,COALESCE($10::date,current_date))`,
            [
              item.productId, dispenseId, lotNo, item.qty, Number(onHand[0]?.on_hand ?? 0),
              (prod.schedule as string) ?? null, dto.prescriber ?? null, dto.patientRef ?? null, dto.prescriptionRef ?? null, dto.occurredOn ?? null,
            ],
          );
        }

        subtotal += line.grossMinor;
        discount += line.discountMinor;
        tax += line.taxMinor;
        total += line.lineTotalMinor;
        cogs += cogsMinor;
      }

      await m.query(
        `UPDATE pharmacy_dispense SET subtotal_minor=$1, discount_minor=$2, tax_minor=$3, total_minor=$4, cogs_minor=$5, updated_at=now() WHERE id=$6`,
        [subtotal, discount, tax, total, cogs, dispenseId],
      );

      await this.outbox.write(m, EVENT_TYPES.PHARMACY_DISPENSE_COMPLETED, {
        dispenseId, dispenseNo, type, totalMinor: total, cogsMinor: cogs, currency, lineCount: dto.items.length,
      });

      return {
        id: dispenseId, dispenseNo, type, status: 'COMPLETED',
        subtotal: money(subtotal, currency), discount: money(discount, currency), tax: money(tax, currency),
        total: money(total, currency), cogs: money(cogs, currency), lines: dto.items.length,
      };
    });
  }

  async returnDispense(id: string, dto: ReturnDispenseDto) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(
        `SELECT id, dispense_no, type, status, currency FROM pharmacy_dispense WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!h[0]) throw new NotFoundException('Dispense not found');
      if (h[0].status !== 'COMPLETED') throw new UnprocessableEntityException(`Cannot return a ${h[0].status} dispense`);
      const currency = h[0].currency as string;
      const dispenseNo = h[0].dispense_no as string;

      const items = (await m.query(
        `SELECT product_id, lot_id, qty, unit_cost_minor FROM pharmacy_dispense_item WHERE dispense_id=$1`,
        [id],
      )) as Row[];
      for (const it of items) {
        await this.stock.restockInTx(m, {
          productId: it.product_id as string,
          lotId: (it.lot_id as string) ?? null,
          qty: Number(it.qty),
          unitCostMinor: Number(it.unit_cost_minor),
          docType: 'DSP_RETURN',
          docNo: dispenseNo,
        });
        const onHand = (await m.query(`SELECT on_hand, (SELECT controlled FROM pharmacy_drug WHERE product_id=$1 AND deleted_at IS NULL) AS controlled FROM inventory_product WHERE id=$1`, [it.product_id])) as Row[];
        if (onHand[0] && Boolean(onHand[0].controlled)) {
          await m.query(
            `INSERT INTO pharmacy_controlled_register (tenant_id, product_id, dispense_id, direction, qty, balance_after, notes, occurred_on)
             VALUES (current_setting('app.tenant_id')::uuid, $1,$2,'IN',$3,$4,$5,current_date)`,
            [it.product_id, id, Number(it.qty), Number(onHand[0].on_hand ?? 0), `Return ${dispenseNo}`],
          );
        }
      }

      await m.query(`UPDATE pharmacy_dispense SET status='RETURNED', notes=COALESCE($2,notes), updated_at=now() WHERE id=$1`, [id, dto.reason ?? null]);

      // Re-emit so the GL consumer posts the reversing voucher (it reads status=RETURNED).
      const totals = (await m.query(`SELECT total_minor, cogs_minor, type FROM pharmacy_dispense WHERE id=$1`, [id])) as Row[];
      await this.outbox.write(m, EVENT_TYPES.PHARMACY_DISPENSE_COMPLETED, {
        dispenseId: id, dispenseNo, type: totals[0]!.type as string, totalMinor: Number(totals[0]!.total_minor),
        cogsMinor: Number(totals[0]!.cogs_minor), currency, lineCount: items.length,
      });

      return { id, dispenseNo, status: 'RETURNED', restocked: items.length };
    });
  }

  // ── Reads ──────────────────────────────────────────────────────────────────────
  async listDispenses(query: { type?: string; status?: string }) {
    return this.tenantTx.run((m) => {
      const conds = ['d.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.type) conds.push(`d.type = $${params.push(query.type)}`);
      if (query.status) conds.push(`d.status = $${params.push(query.status)}`);
      return m.query(
        `SELECT d.id, d.dispense_no, d.type, d.status, d.currency, d.total_minor, d.cogs_minor, d.payment_method,
                d.patient_ref, d.occurred_on::text AS occurred_on, c.name AS customer,
                count(i.id)::int AS line_count
         FROM pharmacy_dispense d
         LEFT JOIN customer c ON c.id = d.customer_id
         LEFT JOIN pharmacy_dispense_item i ON i.dispense_id = d.id
         WHERE ${conds.join(' AND ')} GROUP BY d.id, c.name ORDER BY d.created_at DESC`,
        params,
      );
    });
  }

  async getDispense(id: string) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(
        `SELECT d.id, d.dispense_no, d.type, d.status, d.currency, d.subtotal_minor, d.discount_minor, d.tax_minor,
                d.total_minor, d.cogs_minor, d.payment_method, d.insurer, d.insurance_cover_minor, d.patient_ref,
                d.prescriber, d.prescription_ref, d.ward, d.occurred_on::text AS occurred_on, d.notes, c.name AS customer
         FROM pharmacy_dispense d LEFT JOIN customer c ON c.id = d.customer_id
         WHERE d.id=$1 AND d.deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!h[0]) throw new NotFoundException('Dispense not found');
      const items = (await m.query(
        `SELECT i.id, i.product_id, p.sku, p.name, i.lot_no, i.expiry_date::text AS expiry_date, i.qty,
                i.unit_price_minor, i.unit_cost_minor, i.discount_minor, i.tax_minor, i.line_total_minor
         FROM pharmacy_dispense_item i JOIN inventory_product p ON p.id = i.product_id
         WHERE i.dispense_id=$1 ORDER BY i.created_at`,
        [id],
      )) as Row[];
      const r = h[0];
      const cur = r.currency as string;
      return {
        id: r.id, dispenseNo: r.dispense_no, type: r.type, status: r.status, currency: cur,
        subtotal: money(r.subtotal_minor, cur), discount: money(r.discount_minor, cur), tax: money(r.tax_minor, cur),
        total: money(r.total_minor, cur), cogs: money(r.cogs_minor, cur), paymentMethod: r.payment_method,
        insurer: r.insurer ?? null, insuranceCover: money(r.insurance_cover_minor, cur),
        customer: r.customer ?? null, patientRef: r.patient_ref ?? null, prescriber: r.prescriber ?? null,
        prescriptionRef: r.prescription_ref ?? null, ward: r.ward ?? null, occurredOn: r.occurred_on, notes: r.notes ?? null,
        items: items.map((i) => ({
          id: i.id, productId: i.product_id, sku: i.sku, name: i.name, lotNo: i.lot_no ?? null,
          expiryDate: (i.expiry_date as string) ?? null, qty: Number(i.qty), unitPrice: money(i.unit_price_minor, cur),
          unitCost: money(i.unit_cost_minor, cur), discount: money(i.discount_minor, cur), tax: money(i.tax_minor, cur),
          lineTotal: money(i.line_total_minor, cur),
        })),
      };
    });
  }

  /** Read a dispense in the shape the GL consumer posts from. */
  async dispenseForGlInTx(m: Mgr, id: string): Promise<DispenseForGl | null> {
    const rows = (await m.query(
      `SELECT dispense_no, type, status, total_minor, tax_minor, cogs_minor, payment_method, insurance_cover_minor,
              occurred_on::text AS occurred_on
       FROM pharmacy_dispense WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      dispenseNo: r.dispense_no as string,
      type: r.type as DispenseForGl['type'],
      status: r.status as DispenseForGl['status'],
      totalMinor: Number(r.total_minor),
      taxMinor: Number(r.tax_minor),
      cogsMinor: Number(r.cogs_minor),
      paymentMethod: r.payment_method as string,
      insuranceCoverMinor: Number(r.insurance_cover_minor),
      occurredOn: (r.occurred_on as string) ?? new Date().toISOString().slice(0, 10),
    };
  }

  // ── Controlled-substance register report ────────────────────────────────────────
  async controlledRegister(productId?: string) {
    return this.tenantTx.run((m) => {
      const conds = ['r.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (productId) conds.push(`r.product_id = $${params.push(productId)}`);
      return m.query(
        `SELECT r.id, r.product_id, p.sku, p.name, r.direction, r.lot_no, r.qty, r.balance_after, r.schedule,
                r.prescriber, r.patient_ref, r.prescription_ref, r.occurred_on::text AS occurred_on, d.dispense_no
         FROM pharmacy_controlled_register r
         JOIN inventory_product p ON p.id = r.product_id
         LEFT JOIN pharmacy_dispense d ON d.id = r.dispense_id
         WHERE ${conds.join(' AND ')} ORDER BY r.occurred_on DESC, r.created_at DESC`,
        params,
      );
    });
  }
}
