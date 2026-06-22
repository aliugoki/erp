import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateWardRequisitionDto, IssueWardRequisitionDto } from './dto/pharmacy.dto';
import { PharmacyDispenseService } from './pharmacy-dispense.service';
import { DOC_PREFIX, type Row, formatDocNo } from './pharmacy.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Hospital ward requisitions: a ward raises a request, a pharmacist approves it, then issues it. The
 * issue is a HOSPITAL_ISSUE dispense (FEFO + GL via the shared dispense path) charged to the
 * ward/patient on credit — so inpatient medication consumption hits the ledger like any other dispense.
 */
@Injectable()
export class PharmacyWardService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly dispense: PharmacyDispenseService,
  ) {}

  private async nextDocNo(m: Mgr): Promise<string> {
    const seq = (await m.query(
      `INSERT INTO pharmacy_doc_seq (tenant_id, doc_type, last_no) VALUES (current_setting('app.tenant_id')::uuid, 'WREQ', 1)
       ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = pharmacy_doc_seq.last_no + 1 RETURNING last_no`,
    )) as Array<{ last_no: string }>;
    return formatDocNo(DOC_PREFIX.WREQ, Number(seq[0]!.last_no));
  }

  async create(dto: CreateWardRequisitionDto) {
    return this.tenantTx.run(async (m) => {
      const reqNo = await this.nextDocNo(m);
      const rows = (await m.query(
        `INSERT INTO pharmacy_ward_requisition (tenant_id, req_no, ward, requested_by, priority, patient_ref, needed_by, notes, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,COALESCE($4,'ROUTINE'),$5,$6,$7,'DRAFT')
         RETURNING id, req_no, status`,
        [reqNo, dto.ward, dto.requestedBy ?? null, dto.priority ?? null, dto.patientRef ?? null, dto.neededBy ?? null, dto.notes ?? null],
      )) as Row[];
      const req = rows[0]!;
      for (const i of dto.items) {
        try {
          await m.query(
            `INSERT INTO pharmacy_ward_requisition_item (tenant_id, requisition_id, product_id, qty)
             VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3)`,
            [req.id, i.productId, i.qty],
          );
        } catch (err) {
          if ((err as { code?: string })?.code === '23503') throw new BadRequestException('One or more products do not exist in this tenant');
          throw err;
        }
      }
      return { id: req.id, reqNo: req.req_no, status: req.status, items: dto.items.length };
    });
  }

  async setStatus(id: string, to: 'SUBMITTED' | 'APPROVED' | 'CANCELLED') {
    const allowed: Record<string, string[]> = {
      SUBMITTED: ['DRAFT'],
      APPROVED: ['SUBMITTED'],
      CANCELLED: ['DRAFT', 'SUBMITTED', 'APPROVED'],
    };
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status FROM pharmacy_ward_requisition WHERE id=$1 AND deleted_at IS NULL`, [id])) as Array<{ status: string }>;
      if (!cur[0]) throw new NotFoundException('Ward requisition not found');
      if (!(allowed[to] ?? []).includes(cur[0].status)) throw new UnprocessableEntityException(`Cannot move a ${cur[0].status} requisition to ${to}`);
      await m.query(`UPDATE pharmacy_ward_requisition SET status=$1, updated_at=now() WHERE id=$2`, [to, id]);
      return { id, status: to };
    });
  }

  /** Issue an approved requisition: ring a HOSPITAL_ISSUE dispense for the outstanding lines + mark issued. */
  async issue(id: string, dto: IssueWardRequisitionDto) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(`SELECT id, req_no, ward, patient_ref, status FROM pharmacy_ward_requisition WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      if (!h[0]) throw new NotFoundException('Ward requisition not found');
      if (h[0].status !== 'APPROVED') throw new UnprocessableEntityException('Requisition must be APPROVED before issuing');
      const reqItems = (await m.query(`SELECT id, product_id, qty, issued_qty FROM pharmacy_ward_requisition_item WHERE requisition_id=$1`, [id])) as Row[];
      const lines = reqItems
        .map((r) => ({ itemId: r.id as string, productId: r.product_id as string, qty: Number(r.qty) - Number(r.issued_qty) }))
        .filter((l) => l.qty > 0);
      if (lines.length === 0) throw new UnprocessableEntityException('Nothing outstanding to issue');

      const result = await this.dispense.createDispenseInTx(m, {
        type: 'HOSPITAL_ISSUE',
        paymentMethod: 'CREDIT',
        ward: h[0].ward as string,
        ...(h[0].patient_ref ? { patientRef: h[0].patient_ref as string } : {}),
        ...(dto.notes ? { notes: dto.notes } : {}),
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      });

      for (const l of lines) {
        await m.query(`UPDATE pharmacy_ward_requisition_item SET issued_qty = issued_qty + $1, updated_at=now() WHERE id=$2`, [l.qty, l.itemId]);
      }
      await m.query(`UPDATE pharmacy_ward_requisition SET status='ISSUED', updated_at=now() WHERE id=$1`, [id]);
      return { id, reqNo: h[0].req_no, status: 'ISSUED', dispense: result };
    });
  }

  async list(status?: string) {
    return this.tenantTx.run((m) => {
      const conds = ['r.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (status) conds.push(`r.status = $${params.push(status)}`);
      return m.query(
        `SELECT r.id, r.req_no, r.ward, r.requested_by, r.priority, r.patient_ref, r.status, r.needed_by::text AS needed_by,
                count(i.id)::int AS item_count
         FROM pharmacy_ward_requisition r LEFT JOIN pharmacy_ward_requisition_item i ON i.requisition_id = r.id
         WHERE ${conds.join(' AND ')} GROUP BY r.id ORDER BY r.created_at DESC`,
        params,
      );
    });
  }

  async get(id: string) {
    return this.tenantTx.run(async (m) => {
      const h = (await m.query(
        `SELECT id, req_no, ward, requested_by, priority, patient_ref, status, needed_by::text AS needed_by, notes
         FROM pharmacy_ward_requisition WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!h[0]) throw new NotFoundException('Ward requisition not found');
      const items = (await m.query(
        `SELECT ri.id, ri.product_id, p.sku, p.name, ri.qty, ri.issued_qty
         FROM pharmacy_ward_requisition_item ri JOIN inventory_product p ON p.id = ri.product_id
         WHERE ri.requisition_id=$1 ORDER BY ri.created_at`,
        [id],
      )) as Row[];
      const r = h[0];
      return {
        id: r.id, reqNo: r.req_no, ward: r.ward, requestedBy: r.requested_by ?? null, priority: r.priority,
        patientRef: r.patient_ref ?? null, status: r.status, neededBy: r.needed_by ?? null, notes: r.notes ?? null,
        items: items.map((i) => ({ id: i.id, productId: i.product_id, sku: i.sku, name: i.name, qty: Number(i.qty), issuedQty: Number(i.issued_qty) })),
      };
    });
  }
}
