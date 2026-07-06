import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { RequestContext } from '../../common/request-context/request-context';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateTransactionDto } from '../finance/dto/finance.dto';
import type { ControlType } from '../finance/finance.util';
import { FinanceService } from '../finance/finance.service';
import type { CreateExpenseClaimDto, DecideClaimDto, ExpenseLineDto, PayClaimDto, UpdateExpenseClaimDto } from './dto/expense-claim.dto';

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
const isFk = (e: unknown): boolean => (e as { code?: string })?.code === '23503';
const toDateStr = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string) ?? null);

interface Line { description: string; amountMinor: number; expenseAccountId: string | null }
const cleanLines = (lines: ExpenseLineDto[]): Line[] =>
  lines.map((l) => ({ description: l.description, amountMinor: Math.round(l.amountMinor), expenseAccountId: l.expenseAccountId ?? null }));
const linesTotal = (lines: Line[]): number => lines.reduce((s, l) => s + Math.max(0, l.amountMinor), 0);

/**
 * Employee expense claims (reimbursements). Raw SQL through the tenant tx (RLS). Workflow:
 * DRAFT → SUBMITTED → APPROVED/REJECTED → PAID. Paying with a cash/bank account also posts the
 * reimbursement to the GL (Dr each line's expense account / Cr cash·bank) via {@link FinanceService}.
 */
@Injectable()
export class ExpenseClaimsService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly finance: FinanceService,
  ) {}

  async create(dto: CreateExpenseClaimDto) {
    const lines = cleanLines(dto.lines);
    const total = linesTotal(lines);
    return this.tenantTx.run(async (m) => {
      const claimNo = `EXP-${randomBytes(3).toString('hex').toUpperCase()}`;
      try {
        const rows = (await m.query(
          `INSERT INTO expense_claim (tenant_id, claim_no, employee_id, claim_date, title, status, total_minor, branch_id, cost_center_id, lines)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,'DRAFT',$5,$6,$7,$8::jsonb)
           RETURNING id`,
          [claimNo, dto.employeeId, dto.claimDate ?? null, dto.title ?? '', total, dto.branchId ?? null, dto.costCenterId ?? null, JSON.stringify(lines)],
        )) as Row[];
        return this.getWith(m, rows[0]!.id as string);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee, branch or cost center for this tenant');
        throw err;
      }
    });
  }

  async list(status?: string) {
    return this.tenantTx.run(async (m) => {
      const params: unknown[] = [];
      let where = 'c.deleted_at IS NULL';
      if (status) { params.push(status); where += ` AND c.status=$${params.length}`; }
      const rows = (await m.query(`${SELECT} WHERE ${where} ORDER BY c.created_at DESC`, params)) as Row[];
      return rows.map(mapClaim);
    });
  }

  async get(id: string) {
    return this.tenantTx.run((m) => this.getWith(m, id));
  }

  private async getWith(m: EntityManager, id: string) {
    const rows = (await m.query(`${SELECT} WHERE c.id=$1 AND c.deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Claim not found');
    return mapClaim(rows[0]);
  }

  /** Edit a DRAFT claim (recomputes the total when lines change). */
  async update(id: string, dto: UpdateExpenseClaimDto) {
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status FROM expense_claim WHERE id=$1 AND deleted_at IS NULL`, [id])) as Array<{ status: string }>;
      if (!cur[0]) throw new NotFoundException('Claim not found');
      if (cur[0].status !== 'DRAFT') throw new UnprocessableEntityException('Only a draft claim can be edited');
      const sets: string[] = [];
      const params: unknown[] = [id];
      const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col}=$${params.length}`); };
      if (dto.title !== undefined) push('title', dto.title);
      if (dto.claimDate !== undefined) push('claim_date', dto.claimDate);
      if (dto.branchId !== undefined) push('branch_id', dto.branchId);
      if (dto.costCenterId !== undefined) push('cost_center_id', dto.costCenterId);
      if (dto.lines !== undefined) {
        const lines = cleanLines(dto.lines);
        push('lines', JSON.stringify(lines));
        sets[sets.length - 1] = `lines=$${params.length}::jsonb`;
        push('total_minor', linesTotal(lines));
      }
      if (sets.length) {
        try {
          await m.query(`UPDATE expense_claim SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, params);
        } catch (err) {
          if (isFk(err)) throw new BadRequestException('Unknown branch or cost center for this tenant');
          throw err;
        }
      }
      return this.getWith(m, id);
    });
  }

  async submit(id: string) {
    return this.transition(id, ['DRAFT'], async (m) => {
      await m.query(`UPDATE expense_claim SET status='SUBMITTED', updated_at=now() WHERE id=$1`, [id]);
    });
  }

  async decide(id: string, dto: DecideClaimDto) {
    return this.transition(id, ['SUBMITTED'], async (m) => {
      await m.query(
        `UPDATE expense_claim SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4, updated_at=now() WHERE id=$1`,
        [id, dto.decision, RequestContext.userId() ?? null, dto.note ?? null],
      );
    });
  }

  /** Pay/reimburse an APPROVED claim. With a cash/bank `paymentAccountId`, also posts the GL voucher
   * (Dr each line's expense account / Cr cash·bank) atomically and links the journal. */
  async pay(id: string, dto: PayClaimDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT status, total_minor, lines FROM expense_claim WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )) as Array<{ status: string; total_minor: string; lines: Line[] }>;
      const claim = rows[0];
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status !== 'APPROVED') throw new UnprocessableEntityException(`Only an approved claim can be paid (it is ${claim.status})`);

      let journalId: string | null = null;
      if (dto.paymentAccountId) {
        const lines = claim.lines ?? [];
        if (lines.some((l) => !l.expenseAccountId)) {
          throw new UnprocessableEntityException('Every line needs an expense account to post the reimbursement to the ledger');
        }
        const pa = (await m.query(`SELECT control_type FROM finance_account WHERE id=$1 AND deleted_at IS NULL`, [dto.paymentAccountId])) as Array<{ control_type: ControlType }>;
        const ctrl = pa[0]?.control_type ?? 'NONE';
        const voucherType = ctrl === 'BANK' ? 'BPV' : ctrl === 'CASH' ? 'CPV' : 'JV';
        // Aggregate debits per expense account, then one credit to the cash/bank account.
        const byAccount = new Map<string, number>();
        for (const l of lines) byAccount.set(l.expenseAccountId!, (byAccount.get(l.expenseAccountId!) ?? 0) + Math.max(0, l.amountMinor));
        const entries: Array<{ accountId: string; debitMinor?: number; creditMinor?: number }> =
          [...byAccount].map(([accountId, amt]) => ({ accountId, debitMinor: amt }));
        entries.push({ accountId: dto.paymentAccountId, creditMinor: num(claim.total_minor) });
        const posted = (await this.finance.postJournalInTx(m, {
          description: `Expense reimbursement ${id}`,
          voucherType,
          occurredOn: dto.paidOn ?? undefined,
          entries,
        } as unknown as CreateTransactionDto)) as { id: string };
        journalId = posted.id;
      }
      await m.query(
        `UPDATE expense_claim SET status='PAID', paid_on=COALESCE($2::date, current_date), journal_id=$3, updated_at=now() WHERE id=$1`,
        [id, dto.paidOn ?? null, journalId],
      );
      return this.getWith(m, id);
    });
  }

  private async transition(id: string, from: string[], apply: (m: EntityManager) => Promise<void>) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT status FROM expense_claim WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Array<{ status: string }>;
      if (!rows[0]) throw new NotFoundException('Claim not found');
      if (!from.includes(rows[0].status)) throw new UnprocessableEntityException(`Cannot do that from status ${rows[0].status}`);
      await apply(m);
      return this.getWith(m, id);
    });
  }
}

const SELECT = `
  SELECT c.id, c.claim_no, c.employee_id, c.claim_date::text AS claim_date, c.title, c.status, c.total_minor,
         c.currency, c.branch_id, c.cost_center_id, c.lines, c.decided_by, c.decided_at, c.decision_note,
         c.journal_id, c.paid_on::text AS paid_on,
         (e.first_name || ' ' || e.last_name) AS employee_name, e.employee_code,
         b.name AS branch_name, cc.name AS cost_center_name, t.voucher_no AS journal_voucher_no
  FROM expense_claim c
  LEFT JOIN hr_employee e ON e.id = c.employee_id
  LEFT JOIN branch b ON b.id = c.branch_id
  LEFT JOIN cost_center cc ON cc.id = c.cost_center_id
  LEFT JOIN finance_transaction t ON t.id = c.journal_id`;

function mapClaim(r: Row) {
  const currency = (r.currency as string) ?? 'PKR';
  const lines = (r.lines as Line[]) ?? [];
  return {
    id: r.id as string,
    claimNo: r.claim_no as string,
    employeeId: r.employee_id as string,
    employeeName: (r.employee_name as string) ?? null,
    employeeCode: (r.employee_code as string) ?? null,
    claimDate: (r.claim_date as string) ?? null,
    title: (r.title as string) ?? '',
    status: r.status as string,
    total: { amountMinor: num(r.total_minor), currency },
    branchId: (r.branch_id as string) ?? null,
    branchName: (r.branch_name as string) ?? null,
    costCenterId: (r.cost_center_id as string) ?? null,
    costCenterName: (r.cost_center_name as string) ?? null,
    lines: lines.map((l) => ({ description: l.description, amountMinor: num(l.amountMinor), expenseAccountId: l.expenseAccountId ?? null })),
    decidedBy: (r.decided_by as string) ?? null,
    decidedAt: (r.decided_at as string) ?? null,
    decisionNote: (r.decision_note as string) ?? null,
    journalId: (r.journal_id as string) ?? null,
    journalVoucherNo: (r.journal_voucher_no as string) ?? null,
    paidOn: toDateStr(r.paid_on),
  };
}
