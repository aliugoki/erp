import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EVENT_TYPES, type SuccessEnvelope, paginationMeta } from '@metaxperts/shared';
import { RequestContext } from '../../common/request-context/request-context';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import { PolicyService } from '../policy/policy.service';
import { normalizePagination } from '../hr/hr.util';
import type {
  AsOfQueryDto,
  AutoMatchDto,
  CashBookQueryDto,
  ConvertQueryDto,
  CreateAccountDto,
  ImportStatementDto,
  BudgetQueryDto,
  CreateBillDto,
  CreateBillPaymentDto,
  CreateCostCenterDto,
  CreateCurrencyDto,
  CreateInvoiceDto,
  SetRateDto,
  CreatePeriodDto,
  CreateRecurringDto,
  CreateTransactionDto,
  CreateVendorDto,
  CreateCustomerDto,
  SetBudgetDto,
  LedgerQueryDto,
  ListBillsQueryDto,
  ListInvoicesQueryDto,
  ListTransactionsQueryDto,
  PayInvoiceDto,
  PeriodQueryDto,
  ReconcileDto,
  RevalueFxDto,
  UpdateAccountDto,
  UpdatePeriodDto,
  YearEndCloseDto,
} from './dto/finance.dto';
import {
  type AccountType,
  AGING_BUCKETS,
  type AgingBucket,
  type ControlType,
  MAX_ACCOUNT_LEVELS,
  UnbalancedTransactionError,
  type VoucherType,
  VoucherValidationError,
  type Frequency,
  RATE_SCALE,
  agingBucket,
  assertBalanced,
  assertVoucherType,
  cashFlowSection,
  convertViaBase,
  frequencyInterval,
  microToRate,
  rateToMicro,
  computeInvoiceTotals,
  formatVoucherNo,
  normalBalance,
  signedBalanceMinor,
  trialColumns,
} from './finance.util';

type Row = Record<string, unknown>;

@Injectable()
export class FinanceService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
    private readonly policy: PolicyService,
  ) {}

  // ── Chart of accounts (hierarchical, max 4 levels) ───────────────────────────
  async createAccount(dto: CreateAccountDto) {
    return this.tenantTx.run(async (m) => {
      let level = 1;
      let type = dto.type;
      if (dto.parentId) {
        const parent = (await m.query(
          `SELECT type, is_group, level FROM finance_account WHERE id=$1 AND deleted_at IS NULL`,
          [dto.parentId],
        )) as Array<{ type: string; is_group: boolean; level: number }>;
        if (!parent[0]) throw new BadRequestException('Parent account not found in this tenant');
        if (!parent[0].is_group) {
          throw new UnprocessableEntityException('Parent must be a group account');
        }
        level = Number(parent[0].level) + 1;
        if (level > MAX_ACCOUNT_LEVELS) {
          throw new UnprocessableEntityException(`The chart of accounts is limited to ${MAX_ACCOUNT_LEVELS} levels`);
        }
        // Sub-accounts inherit their parent's type so a branch stays type-consistent.
        type = parent[0].type;
      } else if (!type) {
        throw new BadRequestException('A root (level-1) account requires a type');
      }
      const isGroup = dto.isGroup ?? false;
      const controlType = (dto.controlType ?? 'NONE') as ControlType;
      if ((controlType === 'CASH' || controlType === 'BANK') && isGroup) {
        throw new UnprocessableEntityException('Only a postable (non-group) account can be a cash/bank account');
      }
      try {
        const rows = (await m.query(
          `INSERT INTO finance_account (tenant_id, code, name, type, parent_id, is_group, level, control_type, bank_name, account_number, currency)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, code, name, type, parent_id, is_group, level, control_type, bank_name, account_number, currency`,
          [dto.code, dto.name, type, dto.parentId ?? null, isGroup, level, controlType, dto.bankName ?? null, dto.accountNumber ?? null, dto.currency?.toUpperCase() ?? null],
        )) as Row[];
        return mapAccount(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Account code "${dto.code}" already exists`);
        throw err;
      }
    });
  }

  /** Edit an account's display name and cash/bank tagging (structure stays fixed). */
  async updateAccount(id: string, dto: UpdateAccountDto) {
    return this.tenantTx.run(async (m) => {
      const existing = (await m.query(
        `SELECT is_group FROM finance_account WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Array<{ is_group: boolean }>;
      if (!existing[0]) throw new NotFoundException('Account not found');
      if ((dto.controlType === 'CASH' || dto.controlType === 'BANK') && existing[0].is_group) {
        throw new UnprocessableEntityException('Only a postable (non-group) account can be a cash/bank account');
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      if (dto.name !== undefined) sets.push(`name = $${params.push(dto.name)}`);
      if (dto.controlType !== undefined) sets.push(`control_type = $${params.push(dto.controlType)}`);
      if (dto.bankName !== undefined) sets.push(`bank_name = $${params.push(dto.bankName)}`);
      if (dto.accountNumber !== undefined) sets.push(`account_number = $${params.push(dto.accountNumber)}`);
      if (!sets.length) throw new BadRequestException('No fields to update');
      const rows = (await m.query(
        `UPDATE finance_account SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${params.push(id)} AND deleted_at IS NULL
         RETURNING id, code, name, type, parent_id, is_group, level, control_type, bank_name, account_number, currency`,
        params,
      )) as Row[];
      return mapAccount(rows[0]!);
    });
  }

  /** The chart of accounts as a tree-ordered flat list (each row carries its depth `level`). */
  async listAccounts() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`
        WITH RECURSIVE tree AS (
          SELECT id, code, name, type, parent_id, is_group, control_type, bank_name, account_number, currency, 1 AS level, ARRAY[code] AS path
            FROM finance_account
           WHERE deleted_at IS NULL AND parent_id IS NULL
          UNION ALL
          SELECT c.id, c.code, c.name, c.type, c.parent_id, c.is_group, c.control_type, c.bank_name, c.account_number, c.currency, t.level + 1, t.path || c.code
            FROM finance_account c
            JOIN tree t ON c.parent_id = t.id
           WHERE c.deleted_at IS NULL
        )
        SELECT id, code, name, type, parent_id, is_group, control_type, bank_name, account_number, currency, level FROM tree ORDER BY path
      `)) as Row[];
      return rows.map(mapAccount);
    });
  }

  // ── Transactions (double-entry) ─────────────────────────────────────────────
  async createTransaction(dto: CreateTransactionDto) {
    // Policies (ADR-011), evaluated on the user-facing path only (automated postJournalInTx exempt).
    const tenantId = RequestContext.tenantId();
    if (tenantId) {
      // Require a cost centre on every voucher line when the tenant turns it on.
      if (await this.policy.getBool(tenantId, 'finance.require_cost_center')) {
        if ((dto.entries ?? []).some((e) => !e.costCenterId)) {
          throw new UnprocessableEntityException('Company policy requires a cost centre on every voucher line.');
        }
      }
      // A voucher at/above the approval threshold can't be posted in one step — it must be submitted
      // as a draft for a second approver. Drafts are exempt. Threshold 0 (default) = no restriction.
      if (!dto.draft) {
        const threshold = await this.policy.getNumber(tenantId, 'finance.voucher_approval_threshold_minor');
        if (threshold > 0) {
          const total = (dto.entries ?? []).reduce((s, e) => s + (e.debitMinor ?? 0), 0);
          if (total >= threshold) {
            throw new UnprocessableEntityException(
              `Voucher total (${total} minor) is at or above the approval threshold (${threshold}); submit it as a draft so a second approver can post it.`,
            );
          }
        }
      }
    }
    return this.tenantTx.run((m) => this.postInTx(m, dto));
  }

  /** Public seam: post a balanced voucher inside the CALLER's tenant transaction (e.g. an event
   * consumer posting depreciation atomically with its idempotency row). Same validation as a normal
   * post (balance, leaf accounts, voucher rule, period lock). */
  async postJournalInTx(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    dto: CreateTransactionDto,
  ): Promise<unknown> {
    return this.postInTx(m, dto);
  }

  /**
   * Post a balanced voucher within an EXISTING tenant transaction (so AP/AR can post atomically with
   * a bill/payment). Validates balance, leaf accounts, voucher cash/bank rule, period lock; allocates
   * the voucher number; inserts the transaction + journal lines.
   */
  private async postInTx(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    dto: CreateTransactionDto,
  ) {
    // Foreign-currency lines: convert debit/credit to BASE units at the voucher-date rate, keeping the
    // original foreign amount + rate so the ledger stays single-currency but the FX detail is retained.
    const entries: Array<{
      accountId: string;
      debitMinor: number;
      creditMinor: number;
      costCenterId?: string;
      fcCurrency: string | null;
      fcAmountMinor: number | null;
      rateMicro: number | null;
    }> = [];
    for (const e of dto.entries) {
      let debit = e.debitMinor ?? 0;
      let credit = e.creditMinor ?? 0;
      let fcCurrency: string | null = null;
      let fcAmountMinor: number | null = null;
      let rateMicro: number | null = null;
      if (e.currency) {
        const rm = await this.rateMicroAt(m, e.currency, dto.occurredOn);
        if (rm !== RATE_SCALE) {
          fcCurrency = e.currency.toUpperCase();
          fcAmountMinor = debit > 0 ? debit : credit;
          rateMicro = rm;
          debit = Math.round((debit * rm) / RATE_SCALE);
          credit = Math.round((credit * rm) / RATE_SCALE);
        }
      }
      entries.push({ accountId: e.accountId, debitMinor: debit, creditMinor: credit, costCenterId: e.costCenterId, fcCurrency, fcAmountMinor, rateMicro });
    }

    let totals: { debit: number; credit: number };
    try {
      totals = assertBalanced(entries);
    } catch (err) {
      if (err instanceof UnbalancedTransactionError) throw new UnprocessableEntityException(err.message);
      throw err;
    }

    {
      // Postings are only allowed to leaf (non-group) accounts that exist in this tenant.
      const ids = [...new Set(entries.map((e) => e.accountId))];
      const accts = (await m.query(
        `SELECT id, is_group, control_type FROM finance_account WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [ids],
      )) as Array<{ id: string; is_group: boolean; control_type: ControlType }>;
      if (accts.length !== ids.length) {
        throw new BadRequestException('One or more accounts do not exist in this tenant');
      }
      if (accts.some((a) => a.is_group)) {
        throw new UnprocessableEntityException('Cannot post to a group account — choose a leaf account');
      }

      const voucherType = (dto.voucherType ?? 'JV') as VoucherType;

      // Voucher-side rule: receipts/payments must touch the right cash/bank account.
      const controlById = new Map(accts.map((a) => [a.id, a.control_type]));
      try {
        assertVoucherType(
          voucherType,
          entries.map((e) => ({
            controlType: controlById.get(e.accountId) ?? 'NONE',
            debitMinor: e.debitMinor,
            creditMinor: e.creditMinor,
          })),
        );
      } catch (err) {
        if (err instanceof VoucherValidationError) throw new UnprocessableEntityException(err.message);
        throw err;
      }

      // DRAFT vouchers (maker) don't hit the ledger and skip the period lock until posted.
      const status = dto.draft ? 'DRAFT' : 'POSTED';
      if (status === 'POSTED') {
        // Period lock: once fiscal periods exist, the date must fall inside an OPEN one.
        await this.assertOpenPeriod(m, dto.occurredOn);
      }

      // Allocate the next per-tenant, per-type voucher number atomically.
      const seq = (await m.query(
        `INSERT INTO finance_voucher_seq (tenant_id, voucher_type, last_no)
         VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
         ON CONFLICT (tenant_id, voucher_type)
           DO UPDATE SET last_no = finance_voucher_seq.last_no + 1
         RETURNING last_no`,
        [voucherType],
      )) as Array<{ last_no: string }>;
      const voucherNo = formatVoucherNo(voucherType, Number(seq[0]!.last_no));

      const txRows = (await m.query(
        `INSERT INTO finance_transaction (tenant_id, description, voucher_type, voucher_no, occurred_on, reference, status, posted_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, COALESCE($4::date, current_date), $5, $6, CASE WHEN $6='POSTED' THEN now() ELSE NULL END)
         RETURNING id, description, voucher_type, voucher_no, occurred_on, reference, status`,
        [dto.description, voucherType, voucherNo, dto.occurredOn ?? null, dto.reference ?? null, status],
      )) as Row[];
      const txn = txRows[0]!;
      try {
        for (const e of entries) {
          await m.query(
            `INSERT INTO finance_journal_entry (tenant_id, transaction_id, account_id, debit_minor, credit_minor, cost_center_id, fc_currency, fc_amount_minor, fx_rate_micro)
             VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8)`,
            [txn.id, e.accountId, e.debitMinor, e.creditMinor, e.costCenterId ?? null, e.fcCurrency, e.fcAmountMinor, e.rateMicro],
          );
        }
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('One or more accounts or cost centers do not exist in this tenant');
        throw err;
      }
      return {
        id: txn.id,
        description: txn.description,
        voucherType: txn.voucher_type,
        voucherNo: txn.voucher_no,
        status: txn.status,
        occurredOn: txn.occurred_on,
        reference: txn.reference,
        totalDebitMinor: totals.debit,
        totalCreditMinor: totals.credit,
        entries: dto.entries,
      };
    }
  }

  /** Approve a DRAFT voucher → POSTED (subject to the period lock). The checker half of maker/checker. */
  async postTransaction(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, status, occurred_on FROM finance_transaction WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Array<{ id: string; status: string; occurred_on: string }>;
      if (!rows[0]) throw new NotFoundException('Transaction not found');
      if (rows[0].status === 'POSTED') throw new UnprocessableEntityException('Voucher is already posted');
      await this.assertOpenPeriod(m, rows[0].occurred_on);
      await m.query(`UPDATE finance_transaction SET status='POSTED', posted_at=now(), updated_at=now() WHERE id=$1`, [id]);
      return { id, status: 'POSTED' };
    });
  }

  /** Discard a DRAFT voucher (soft delete). Posted vouchers must be reversed, never deleted. */
  async deleteDraft(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT status FROM finance_transaction WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Array<{ status: string }>;
      if (!rows[0]) throw new NotFoundException('Transaction not found');
      if (rows[0].status !== 'DRAFT') throw new UnprocessableEntityException('Only a draft can be deleted; post is reversed');
      await m.query(`UPDATE finance_transaction SET deleted_at=now() WHERE id=$1`, [id]);
      return { id, deleted: true };
    });
  }

  async getTransaction(id: string) {
    return this.tenantTx.run(async (m) => {
      const tx = (await m.query(
        `SELECT id, description, voucher_type, voucher_no, status, occurred_on, reference FROM finance_transaction WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!tx[0]) throw new NotFoundException('Transaction not found');
      const entries = (await m.query(
        `SELECT je.id, je.account_id, a.code AS account_code, a.name AS account_name,
                je.debit_minor, je.credit_minor, je.currency, cc.code AS cost_center_code
           FROM finance_journal_entry je
           LEFT JOIN finance_account a ON a.id = je.account_id
           LEFT JOIN cost_center cc ON cc.id = je.cost_center_id
          WHERE je.transaction_id=$1 ORDER BY je.created_at`,
        [id],
      )) as Row[];
      const r = tx[0]!;
      return {
        id: r.id,
        description: r.description,
        voucherType: r.voucher_type,
        voucherNo: r.voucher_no,
        status: r.status,
        occurredOn: r.occurred_on,
        reference: r.reference ?? null,
        entries: entries.map((e) => ({
          id: e.id,
          accountId: e.account_id,
          accountCode: e.account_code ?? null,
          accountName: e.account_name ?? null,
          costCenterCode: e.cost_center_code ?? null,
          debit: money(e.debit_minor, e.currency as string),
          credit: money(e.credit_minor, e.currency as string),
        })),
      };
    });
  }

  /** Reverse a voucher with a contra entry (debits↔credits), linked for the audit trail. */
  async reverseTransaction(id: string) {
    return this.tenantTx.run(async (m) => {
      const orig = (await m.query(
        `SELECT id, voucher_no, reversed_by_id, status FROM finance_transaction WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Array<{ id: string; voucher_no: string | null; reversed_by_id: string | null; status: string }>;
      if (!orig[0]) throw new NotFoundException('Transaction not found');
      if (orig[0].status !== 'POSTED') throw new UnprocessableEntityException('Only a posted voucher can be reversed');
      if (orig[0].reversed_by_id) throw new UnprocessableEntityException('This voucher has already been reversed');
      const entries = (await m.query(
        `SELECT account_id, debit_minor, credit_minor FROM finance_journal_entry WHERE transaction_id=$1`,
        [id],
      )) as Array<{ account_id: string; debit_minor: string; credit_minor: string }>;

      await this.assertOpenPeriod(m, undefined);

      const seq = (await m.query(
        `INSERT INTO finance_voucher_seq (tenant_id, voucher_type, last_no)
         VALUES (current_setting('app.tenant_id')::uuid, 'JV', 1)
         ON CONFLICT (tenant_id, voucher_type) DO UPDATE SET last_no = finance_voucher_seq.last_no + 1
         RETURNING last_no`,
      )) as Array<{ last_no: string }>;
      const voucherNo = formatVoucherNo('JV', Number(seq[0]!.last_no));
      const rev = (await m.query(
        `INSERT INTO finance_transaction (tenant_id, description, voucher_type, voucher_no, occurred_on, reverses_id, status, posted_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1, 'JV', $2, current_date, $3, 'POSTED', now())
         RETURNING id`,
        [`Reversal of ${orig[0].voucher_no ?? id}`, voucherNo, id],
      )) as Row[];
      const revId = rev[0]!.id as string;
      for (const e of entries) {
        // Swap debit and credit to cancel the original.
        await m.query(
          `INSERT INTO finance_journal_entry (tenant_id, transaction_id, account_id, debit_minor, credit_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4)`,
          [revId, e.account_id, Number(e.credit_minor), Number(e.debit_minor)],
        );
      }
      await m.query(`UPDATE finance_transaction SET reversed_by_id=$1, updated_at=now() WHERE id=$2`, [revId, id]);
      return { id: revId, voucherNo, reversesId: id, reversesVoucherNo: orig[0].voucher_no };
    });
  }

  /** Block posting outside an OPEN fiscal period — but only once the tenant has defined any periods. */
  private async assertOpenPeriod(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    occurredOn?: string,
  ): Promise<void> {
    const any = (await m.query(`SELECT 1 FROM finance_fiscal_period WHERE deleted_at IS NULL LIMIT 1`)) as unknown[];
    if (!any.length) return; // no periods configured → no lock (backward compatible)
    const open = (await m.query(
      `SELECT 1 FROM finance_fiscal_period
        WHERE deleted_at IS NULL AND status='OPEN'
          AND COALESCE($1::date, current_date) BETWEEN start_date AND end_date
        LIMIT 1`,
      [occurredOn ?? null],
    )) as unknown[];
    if (!open.length) {
      throw new UnprocessableEntityException(`No open fiscal period for ${occurredOn ?? 'today'}`);
    }
  }

  // ── Fiscal periods ───────────────────────────────────────────────────────────
  async createPeriod(dto: CreatePeriodDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO finance_fiscal_period (tenant_id, name, start_date, end_date)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)
         RETURNING id, name, start_date, end_date, status`,
        [dto.name, dto.startDate, dto.endDate],
      )) as Row[];
      return mapPeriod(rows[0]!);
    });
  }

  async listPeriods() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, start_date, end_date, status FROM finance_fiscal_period
          WHERE deleted_at IS NULL ORDER BY start_date DESC`,
      )) as Row[];
      return rows.map(mapPeriod);
    });
  }

  async updatePeriod(id: string, dto: UpdatePeriodDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE finance_fiscal_period SET status=$1, updated_at=now()
          WHERE id=$2 AND deleted_at IS NULL
          RETURNING id, name, start_date, end_date, status`,
        [dto.status, id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Period not found');
      return mapPeriod(rows[0]);
    });
  }

  /** Cash & Bank book: opening / receipts / payments / closing for each cash & bank account. */
  async cashBook(query: CashBookQueryDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT a.id, a.code, a.name, a.control_type, a.bank_name, a.account_number,
                COALESCE(SUM(CASE WHEN $1::date IS NOT NULL AND t.occurred_on < $1::date
                                  THEN je.debit_minor - je.credit_minor ELSE 0 END), 0)::bigint AS opening,
                COALESCE(SUM(CASE WHEN ($1::date IS NULL OR t.occurred_on >= $1::date)
                                   AND ($2::date IS NULL OR t.occurred_on <= $2::date)
                                  THEN je.debit_minor ELSE 0 END), 0)::bigint AS receipts,
                COALESCE(SUM(CASE WHEN ($1::date IS NULL OR t.occurred_on >= $1::date)
                                   AND ($2::date IS NULL OR t.occurred_on <= $2::date)
                                  THEN je.credit_minor ELSE 0 END), 0)::bigint AS payments
           FROM finance_account a
           LEFT JOIN finance_journal_entry je ON je.account_id = a.id
           LEFT JOIN finance_transaction t ON t.id = je.transaction_id AND t.deleted_at IS NULL AND t.status='POSTED'
          WHERE a.deleted_at IS NULL AND a.control_type IN ('CASH','BANK')
          GROUP BY a.id
          ORDER BY a.control_type, a.code`,
        [query.from ?? null, query.to ?? null],
      )) as Row[];
      const accounts = rows.map((r) => {
        const opening = Number(r.opening);
        const receipts = Number(r.receipts);
        const payments = Number(r.payments);
        return {
          accountId: r.id,
          code: r.code,
          name: r.name,
          controlType: r.control_type,
          bankName: r.bank_name ?? null,
          accountNumber: r.account_number ?? null,
          opening: money(opening),
          receipts: money(receipts),
          payments: money(payments),
          closing: money(opening + receipts - payments),
        };
      });
      const totals = {
        receiptsMinor: accounts.reduce((s, a) => s + a.receipts.amountMinor, 0),
        paymentsMinor: accounts.reduce((s, a) => s + a.payments.amountMinor, 0),
        closingMinor: accounts.reduce((s, a) => s + a.closing.amountMinor, 0),
      };
      return { from: query.from ?? null, to: query.to ?? null, accounts, totals };
    });
  }

  /** Paginated list of journal transactions (header + its total debit), newest first. */
  async listTransactions(query: ListTransactionsQueryDto): Promise<SuccessEnvelope<unknown[]>> {
    const { page, pageSize, limit, offset } = normalizePagination(query.page, query.pageSize);
    const conditions = ['t.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (query.voucherType) conditions.push(`t.voucher_type = $${params.push(query.voucherType)}`);
    if (query.status) conditions.push(`t.status = $${params.push(query.status)}`);
    if (query.from) conditions.push(`t.occurred_on >= $${params.push(query.from)}`);
    if (query.to) conditions.push(`t.occurred_on <= $${params.push(query.to)}`);
    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT t.id, t.description, t.voucher_type, t.voucher_no, t.status, t.occurred_on, t.reference,
                t.reverses_id, t.reversed_by_id,
                COALESCE(SUM(je.debit_minor), 0)::bigint AS total_debit_minor,
                COUNT(je.id)::int AS line_count
           FROM finance_transaction t
           LEFT JOIN finance_journal_entry je ON je.transaction_id = t.id
           ${where}
          GROUP BY t.id
          ORDER BY t.occurred_on DESC, t.created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      )) as Row[];
      const count = (await m.query(
        `SELECT count(*)::int AS total FROM finance_transaction t ${where}`,
        params,
      )) as Array<{ total: number }>;
      return {
        data: rows.map((r) => ({
          id: r.id,
          description: r.description,
          voucherType: r.voucher_type,
          voucherNo: r.voucher_no ?? null,
          status: r.status,
          occurredOn: r.occurred_on,
          reference: r.reference ?? null,
          reversesId: r.reverses_id ?? null,
          reversedById: r.reversed_by_id ?? null,
          lineCount: Number(r.line_count),
          total: money(r.total_debit_minor),
        })),
        meta: { pagination: paginationMeta(count[0]?.total ?? 0, page, pageSize) },
      };
    });
  }

  // ── General ledger & financial statements (read models over journal entries) ─

  /** Per-account ledger: opening balance + each posting with a running balance (account's normal sign). */
  async getLedger(accountId: string, query: LedgerQueryDto) {
    return this.tenantTx.run(async (m) => {
      const accRows = (await m.query(
        `SELECT id, code, name, type FROM finance_account WHERE id=$1 AND deleted_at IS NULL`,
        [accountId],
      )) as Array<{ id: string; code: string; name: string; type: AccountType }>;
      const account = accRows[0];
      if (!account) throw new NotFoundException('Account not found');
      const sign = normalBalance(account.type) === 'DEBIT' ? 1 : -1;

      // Opening = net movement strictly before `from` (debit-positive). Zero when no `from` given.
      let openingRaw = 0;
      if (query.from) {
        const op = (await m.query(
          `SELECT COALESCE(SUM(je.debit_minor - je.credit_minor), 0)::bigint AS raw
             FROM finance_journal_entry je
             JOIN finance_transaction t ON t.id = je.transaction_id
            WHERE je.account_id=$1 AND t.deleted_at IS NULL AND t.status='POSTED' AND t.occurred_on < $2`,
          [accountId, query.from],
        )) as Array<{ raw: string }>;
        openingRaw = Number(op[0]?.raw ?? 0);
      }

      const conditions = ['je.account_id = $1', "t.deleted_at IS NULL", "t.status = 'POSTED'"];
      const params: unknown[] = [accountId];
      if (query.from) conditions.push(`t.occurred_on >= $${params.push(query.from)}`);
      if (query.to) conditions.push(`t.occurred_on <= $${params.push(query.to)}`);
      const lineRows = (await m.query(
        `SELECT t.id AS transaction_id, t.occurred_on, t.description, t.reference,
                t.voucher_type, t.voucher_no,
                je.debit_minor, je.credit_minor,
                SUM(je.debit_minor - je.credit_minor)
                  OVER (ORDER BY t.occurred_on, t.created_at, je.created_at
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS window_raw
           FROM finance_journal_entry je
           JOIN finance_transaction t ON t.id = je.transaction_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY t.occurred_on, t.created_at, je.created_at`,
        params,
      )) as Row[];

      let movement = 0;
      const lines = lineRows.map((r) => {
        const windowRaw = Number(r.window_raw);
        movement = windowRaw; // last row's cumulative = total in-range movement
        const balanceRaw = openingRaw + windowRaw;
        return {
          transactionId: r.transaction_id,
          occurredOn: r.occurred_on,
          description: r.description,
          voucherType: r.voucher_type,
          voucherNo: r.voucher_no ?? null,
          reference: r.reference ?? null,
          debit: money(r.debit_minor),
          credit: money(r.credit_minor),
          balance: money(sign * balanceRaw),
        };
      });

      return {
        account: { id: account.id, code: account.code, name: account.name, type: account.type },
        opening: money(sign * openingRaw),
        closing: money(sign * (openingRaw + movement)),
        lines,
      };
    });
  }

  /** Aggregate per-account debit/credit sums up to `asOf` (today if omitted) — the report base. */
  private async accountSums(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    upTo?: string,
    onlyTypes?: AccountType[],
    range?: { from?: string; to?: string },
  ): Promise<Array<{ id: string; code: string; name: string; type: AccountType; debit: number; credit: number }>> {
    const conditions = ['a.deleted_at IS NULL', 'a.is_group = false', 't.deleted_at IS NULL', "t.status = 'POSTED'"];
    const params: unknown[] = [];
    if (upTo) conditions.push(`t.occurred_on <= $${params.push(upTo)}`);
    if (range?.from) conditions.push(`t.occurred_on >= $${params.push(range.from)}`);
    if (range?.to) conditions.push(`t.occurred_on <= $${params.push(range.to)}`);
    if (onlyTypes?.length) conditions.push(`a.type = ANY($${params.push(onlyTypes)}::text[])`);
    const rows = (await m.query(
      `SELECT a.id, a.code, a.name, a.type,
              COALESCE(SUM(je.debit_minor), 0)::bigint AS debit,
              COALESCE(SUM(je.credit_minor), 0)::bigint AS credit
         FROM finance_journal_entry je
         JOIN finance_transaction t ON t.id = je.transaction_id
         JOIN finance_account a ON a.id = je.account_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY a.id
        ORDER BY a.code`,
      params,
    )) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      type: r.type as AccountType,
      debit: Number(r.debit),
      credit: Number(r.credit),
    }));
  }

  /** Trial balance: each posted account's net placed in its column; grand totals must be equal. */
  async getTrialBalance(query: AsOfQueryDto) {
    return this.tenantTx.run(async (m) => {
      const sums = await this.accountSums(m, query.asOf);
      let totalDebit = 0;
      let totalCredit = 0;
      const rows = sums
        .map((a) => {
          const cols = trialColumns(a.debit - a.credit);
          totalDebit += cols.debitMinor;
          totalCredit += cols.creditMinor;
          return { accountId: a.id, code: a.code, name: a.name, type: a.type, ...cols };
        })
        .filter((r) => r.debitMinor !== 0 || r.creditMinor !== 0);
      return {
        asOf: query.asOf ?? null,
        rows,
        totals: { debitMinor: totalDebit, creditMinor: totalCredit },
        balanced: totalDebit === totalCredit,
      };
    });
  }

  /** Balance sheet as of a date: Assets = Liabilities + Equity + current-period net income. */
  async getBalanceSheet(query: AsOfQueryDto) {
    return this.tenantTx.run(async (m) => {
      const sums = await this.accountSums(m, query.asOf);
      const section = (type: AccountType) =>
        sums
          .filter((a) => a.type === type)
          .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amountMinor: signedBalanceMinor(type, a.debit, a.credit) }));
      const sum = (lines: Array<{ amountMinor: number }>) => lines.reduce((s, l) => s + l.amountMinor, 0);

      const assets = section('ASSET');
      const liabilities = section('LIABILITY');
      const equity = section('EQUITY');
      const revenue = sum(section('REVENUE'));
      const expenses = sum(section('EXPENSE'));
      const netIncome = revenue - expenses;

      const totalAssets = sum(assets);
      const totalEquity = sum(equity) + netIncome;
      const totalLiabEquity = sum(liabilities) + totalEquity;
      return {
        asOf: query.asOf ?? null,
        currency: 'PKR',
        assets: { lines: assets, totalMinor: totalAssets },
        liabilities: { lines: liabilities, totalMinor: sum(liabilities) },
        equity: { lines: equity, netIncomeMinor: netIncome, totalMinor: totalEquity },
        totals: { assetsMinor: totalAssets, liabilitiesAndEquityMinor: totalLiabEquity },
        balanced: totalAssets === totalLiabEquity,
      };
    });
  }

  /** Income statement (P&L) for a period: Revenue − Expenses = Net income. */
  async getIncomeStatement(query: PeriodQueryDto) {
    return this.tenantTx.run(async (m) => {
      const sums = await this.accountSums(m, undefined, ['REVENUE', 'EXPENSE'], { from: query.from, to: query.to });
      const revenue = sums
        .filter((a) => a.type === 'REVENUE')
        .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amountMinor: signedBalanceMinor('REVENUE', a.debit, a.credit) }));
      const expenses = sums
        .filter((a) => a.type === 'EXPENSE')
        .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amountMinor: signedBalanceMinor('EXPENSE', a.debit, a.credit) }));
      const sum = (lines: Array<{ amountMinor: number }>) => lines.reduce((s, l) => s + l.amountMinor, 0);
      const totalRevenue = sum(revenue);
      const totalExpenses = sum(expenses);
      return {
        from: query.from ?? null,
        to: query.to ?? null,
        currency: 'PKR',
        revenue: { lines: revenue, totalMinor: totalRevenue },
        expenses: { lines: expenses, totalMinor: totalExpenses },
        netIncomeMinor: totalRevenue - totalExpenses,
      };
    });
  }

  /**
   * Cash-flow statement (direct method): classifies every cash/bank movement in the period by the
   * counterpart account into operating / investing / financing. Opening + net change = closing cash.
   */
  async getCashFlow(query: PeriodQueryDto) {
    return this.tenantTx.run(async (m) => {
      const from = query.from ?? null;
      const to = query.to ?? null;
      const cashNet = async (cond: string, params: unknown[]) => {
        const r = (await m.query(
          `SELECT COALESCE(SUM(je.debit_minor - je.credit_minor), 0)::bigint AS raw
             FROM finance_journal_entry je
             JOIN finance_account a ON a.id = je.account_id
             JOIN finance_transaction t ON t.id = je.transaction_id
            WHERE a.control_type IN ('CASH','BANK') AND t.status='POSTED' AND t.deleted_at IS NULL AND ${cond}`,
          params,
        )) as Array<{ raw: string }>;
        return Number(r[0]?.raw ?? 0);
      };
      const opening = from ? await cashNet('t.occurred_on < $1', [from]) : 0;
      const closing = await cashNet('($1::date IS NULL OR t.occurred_on <= $1)', [to]);

      // Non-cash legs of every cash-touching transaction in the period explain the cash movement.
      const rows = (await m.query(
        `WITH cash_txns AS (
           SELECT DISTINCT je.transaction_id
             FROM finance_journal_entry je
             JOIN finance_account a ON a.id = je.account_id
             JOIN finance_transaction t ON t.id = je.transaction_id
            WHERE a.control_type IN ('CASH','BANK') AND t.status='POSTED' AND t.deleted_at IS NULL
              AND ($1::date IS NULL OR t.occurred_on >= $1::date)
              AND ($2::date IS NULL OR t.occurred_on <= $2::date)
         )
         SELECT a.id, a.code, a.name, a.type,
                COALESCE(SUM(je.credit_minor - je.debit_minor), 0)::bigint AS contribution
           FROM finance_journal_entry je
           JOIN finance_account a ON a.id = je.account_id
          WHERE je.transaction_id IN (SELECT transaction_id FROM cash_txns)
            AND a.control_type = 'NONE'
          GROUP BY a.id
         HAVING COALESCE(SUM(je.credit_minor - je.debit_minor), 0) <> 0
          ORDER BY a.type, a.code`,
        [from, to],
      )) as Row[];

      const sections: Record<'operating' | 'investing' | 'financing', { lines: Array<{ accountId: unknown; code: unknown; name: unknown; amountMinor: number }>; totalMinor: number }> = {
        operating: { lines: [], totalMinor: 0 },
        investing: { lines: [], totalMinor: 0 },
        financing: { lines: [], totalMinor: 0 },
      };
      for (const r of rows) {
        const amountMinor = Number(r.contribution);
        const sec = cashFlowSection(r.type as AccountType);
        sections[sec].lines.push({ accountId: r.id, code: r.code, name: r.name, amountMinor });
        sections[sec].totalMinor += amountMinor;
      }
      const netChangeMinor = sections.operating.totalMinor + sections.investing.totalMinor + sections.financing.totalMinor;
      return {
        from,
        to,
        currency: 'PKR',
        opening: money(opening),
        operating: sections.operating,
        investing: sections.investing,
        financing: sections.financing,
        netChangeMinor,
        closing: money(closing),
        reconciles: opening + netChangeMinor === closing,
      };
    });
  }

  // ── Cost centers (analytical dimension) ──────────────────────────────────────
  async createCostCenter(dto: CreateCostCenterDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO cost_center (tenant_id, code, name)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2)
           RETURNING id, code, name, active`,
          [dto.code, dto.name],
        )) as Row[];
        return mapCostCenter(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Cost center code "${dto.code}" already exists`);
        throw err;
      }
    });
  }

  async listCostCenters() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, code, name, active FROM cost_center WHERE deleted_at IS NULL ORDER BY code`,
      )) as Row[];
      return rows.map(mapCostCenter);
    });
  }

  /** Cost-center P&L: revenue, expense and net per cost center (untagged → "Unassigned"). */
  async costCenterReport(query: PeriodQueryDto) {
    return this.tenantTx.run(async (m) => {
      const params: unknown[] = [];
      const range: string[] = [];
      if (query.from) range.push(`t.occurred_on >= $${params.push(query.from)}::date`);
      if (query.to) range.push(`t.occurred_on <= $${params.push(query.to)}::date`);
      const rangeSql = range.length ? `AND ${range.join(' AND ')}` : '';
      const rows = (await m.query(
        `SELECT cc.id AS cost_center_id, cc.code, cc.name,
                COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN je.credit_minor - je.debit_minor ELSE 0 END), 0)::bigint AS revenue,
                COALESCE(SUM(CASE WHEN a.type='EXPENSE' THEN je.debit_minor - je.credit_minor ELSE 0 END), 0)::bigint AS expense
           FROM finance_journal_entry je
           JOIN finance_account a ON a.id = je.account_id
           JOIN finance_transaction t ON t.id = je.transaction_id
           LEFT JOIN cost_center cc ON cc.id = je.cost_center_id
          WHERE t.status='POSTED' AND t.deleted_at IS NULL AND a.type IN ('REVENUE','EXPENSE') ${rangeSql}
          GROUP BY cc.id, cc.code, cc.name
          ORDER BY cc.code NULLS LAST`,
        params,
      )) as Row[];
      let totalRevenue = 0;
      let totalExpense = 0;
      const costCenters = rows.map((r) => {
        const revenue = Number(r.revenue);
        const expense = Number(r.expense);
        totalRevenue += revenue;
        totalExpense += expense;
        return {
          costCenterId: r.cost_center_id ?? null,
          code: r.code ?? null,
          name: r.name ?? 'Unassigned',
          revenue: money(revenue),
          expense: money(expense),
          net: money(revenue - expense),
        };
      });
      return {
        from: query.from ?? null,
        to: query.to ?? null,
        costCenters,
        totals: { revenueMinor: totalRevenue, expenseMinor: totalExpense, netMinor: totalRevenue - totalExpense },
      };
    });
  }

  // ── Budgets ──────────────────────────────────────────────────────────────────
  /** Set (upsert) the budgeted amount for an account in a fiscal period. */
  async setBudget(dto: SetBudgetDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO finance_budget (tenant_id, period_id, account_id, amount_minor)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)
           ON CONFLICT (tenant_id, period_id, account_id)
             DO UPDATE SET amount_minor = EXCLUDED.amount_minor, updated_at = now()
           RETURNING id, period_id, account_id, amount_minor`,
          [dto.periodId, dto.accountId, dto.amountMinor],
        )) as Row[];
        const r = rows[0]!;
        return { id: r.id, periodId: r.period_id, accountId: r.account_id, amount: money(r.amount_minor) };
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('Period or account does not exist in this tenant');
        throw err;
      }
    });
  }

  /** Budget vs actual for a fiscal period: planned amount vs posted net per account, with variance. */
  async budgetVsActual(query: BudgetQueryDto) {
    return this.tenantTx.run(async (m) => {
      const periods = (await m.query(
        `SELECT id, name, start_date, end_date FROM finance_fiscal_period WHERE id=$1 AND deleted_at IS NULL`,
        [query.periodId],
      )) as Array<{ id: string; name: string; start_date: string; end_date: string }>;
      const period = periods[0];
      if (!period) throw new NotFoundException('Period not found');

      const rows = (await m.query(
        `SELECT b.account_id, a.code, a.name, a.type, b.amount_minor AS budget,
                COALESCE(SUM(je.debit_minor), 0)::bigint AS debit,
                COALESCE(SUM(je.credit_minor), 0)::bigint AS credit
           FROM finance_budget b
           JOIN finance_account a ON a.id = b.account_id
           LEFT JOIN finance_journal_entry je ON je.account_id = b.account_id
           LEFT JOIN finance_transaction t ON t.id = je.transaction_id
                AND t.status='POSTED' AND t.deleted_at IS NULL
                AND t.occurred_on BETWEEN $2::date AND $3::date
          WHERE b.period_id = $1 AND b.deleted_at IS NULL
          GROUP BY b.account_id, a.code, a.name, a.type, b.amount_minor
          ORDER BY a.code`,
        [query.periodId, period.start_date, period.end_date],
      )) as Row[];

      let totalBudget = 0;
      let totalActual = 0;
      const lines = rows.map((r) => {
        const budget = Number(r.budget);
        const actual = signedBalanceMinor(r.type as AccountType, Number(r.debit), Number(r.credit));
        totalBudget += budget;
        totalActual += actual;
        return {
          accountId: r.account_id,
          code: r.code,
          name: r.name,
          type: r.type,
          budget: money(budget),
          actual: money(actual),
          variance: money(actual - budget),
          variancePct: budget !== 0 ? Math.round(((actual - budget) / Math.abs(budget)) * 1000) / 10 : null,
        };
      });
      return {
        period: { id: period.id, name: period.name, startDate: period.start_date, endDate: period.end_date },
        lines,
        totals: { budgetMinor: totalBudget, actualMinor: totalActual, varianceMinor: totalActual - totalBudget },
      };
    });
  }

  /** Accounts-receivable aging: outstanding invoices bucketed by days past due. */
  async arAging(query: AsOfQueryDto) {
    return this.tenantTx.run(async (m) => {
      const asOf = query.asOf ? new Date(query.asOf) : new Date();
      const rows = (await m.query(
        `SELECT id, number, client_id, total_minor, currency, due_date, created_at::date AS created_on
           FROM finance_invoice
          WHERE deleted_at IS NULL AND status NOT IN ('PAID','VOID')`,
      )) as Row[];
      const totals: Record<AgingBucket | 'total', number> = {
        current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0,
      };
      const invoices = rows.map((r) => {
        const due = new Date((r.due_date ?? r.created_on) as string);
        const daysPastDue = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
        const bucket = agingBucket(daysPastDue);
        const amountMinor = Number(r.total_minor);
        totals[bucket] += amountMinor;
        totals.total += amountMinor;
        return {
          invoiceId: r.id,
          number: r.number,
          clientId: r.client_id ?? null,
          dueDate: r.due_date ?? r.created_on,
          daysPastDue,
          bucket,
          amount: money(amountMinor, r.currency as string),
        };
      });
      return { asOf: query.asOf ?? null, buckets: [...AGING_BUCKETS], totals, invoices };
    });
  }

  // ── Bank reconciliation ──────────────────────────────────────────────────────
  /** A bank/cash account's postings with their cleared flag + a book-vs-cleared summary. */
  async reconciliation(accountId: string) {
    return this.tenantTx.run(async (m) => {
      const acc = (await m.query(
        `SELECT id, code, name, control_type, bank_name, account_number FROM finance_account WHERE id=$1 AND deleted_at IS NULL`,
        [accountId],
      )) as Row[];
      if (!acc[0]) throw new NotFoundException('Account not found');
      const rows = (await m.query(
        `SELECT je.id, t.occurred_on, t.voucher_no, t.description, je.debit_minor, je.credit_minor, je.reconciled, je.reconciled_at
           FROM finance_journal_entry je
           JOIN finance_transaction t ON t.id = je.transaction_id
          WHERE je.account_id=$1 AND t.deleted_at IS NULL AND t.status='POSTED'
          ORDER BY t.occurred_on, t.created_at, je.created_at`,
        [accountId],
      )) as Row[];
      let book = 0;
      let cleared = 0;
      const entries = rows.map((r) => {
        const net = Number(r.debit_minor) - Number(r.credit_minor); // debit-positive (asset)
        book += net;
        if (r.reconciled) cleared += net;
        return {
          entryId: r.id,
          occurredOn: r.occurred_on,
          voucherNo: r.voucher_no ?? null,
          description: r.description,
          debit: money(r.debit_minor),
          credit: money(r.credit_minor),
          reconciled: Boolean(r.reconciled),
          reconciledAt: r.reconciled_at ?? null,
        };
      });
      return {
        account: { id: acc[0].id, code: acc[0].code, name: acc[0].name, controlType: acc[0].control_type, bankName: acc[0].bank_name ?? null, accountNumber: acc[0].account_number ?? null },
        bookBalance: money(book),
        clearedBalance: money(cleared),
        unclearedBalance: money(book - cleared),
        unclearedCount: entries.filter((e) => !e.reconciled).length,
        entries,
      };
    });
  }

  /** Import bank-statement lines for an account (for later auto-match). */
  async importStatement(dto: ImportStatementDto) {
    return this.tenantTx.run(async (m) => {
      for (const l of dto.lines) {
        await m.query(
          `INSERT INTO bank_statement_line (tenant_id, account_id, stmt_date, description, amount_minor, reference)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5)`,
          [dto.accountId, l.date, l.description ?? null, l.amountMinor, l.reference ?? null],
        );
      }
      return { imported: dto.lines.length };
    });
  }

  async listStatement(accountId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, stmt_date::text AS stmt_date, description, amount_minor, reference, matched_entry_id
           FROM bank_statement_line WHERE account_id=$1 AND deleted_at IS NULL
          ORDER BY stmt_date, created_at`,
        [accountId],
      )) as Row[];
      return rows.map((r) => ({
        id: r.id,
        date: r.stmt_date,
        description: r.description ?? null,
        amount: money(r.amount_minor),
        reference: r.reference ?? null,
        matched: Boolean(r.matched_entry_id),
      }));
    });
  }

  /** Auto-match unmatched statement lines to unreconciled bank postings by signed amount. */
  async autoMatch(dto: AutoMatchDto) {
    return this.tenantTx.run(async (m) => {
      const lines = (await m.query(
        `SELECT id, stmt_date::text AS stmt_date, amount_minor FROM bank_statement_line
          WHERE account_id=$1 AND deleted_at IS NULL AND matched_entry_id IS NULL
          ORDER BY stmt_date, created_at`,
        [dto.accountId],
      )) as Array<{ id: string; stmt_date: string; amount_minor: string }>;
      const entries = (await m.query(
        `SELECT je.id, (je.debit_minor - je.credit_minor) AS net
           FROM finance_journal_entry je
           JOIN finance_transaction t ON t.id = je.transaction_id
          WHERE je.account_id=$1 AND je.reconciled=false AND t.status='POSTED' AND t.deleted_at IS NULL`,
        [dto.accountId],
      )) as Array<{ id: string; net: string }>;

      // Pool of available journal entries keyed by their signed net amount.
      const pool = new Map<number, string[]>();
      for (const e of entries) {
        const net = Number(e.net);
        (pool.get(net) ?? pool.set(net, []).get(net)!).push(e.id);
      }
      let matched = 0;
      for (const line of lines) {
        const want = Number(line.amount_minor);
        const ids = pool.get(want);
        if (ids && ids.length) {
          const jeId = ids.shift()!;
          await m.query(`UPDATE finance_journal_entry SET reconciled=true, reconciled_at=$2 WHERE id=$1`, [jeId, line.stmt_date]);
          await m.query(`UPDATE bank_statement_line SET matched_entry_id=$2, updated_at=now() WHERE id=$1`, [line.id, jeId]);
          matched += 1;
        }
      }
      return { matched, unmatched: lines.length - matched };
    });
  }

  /** Mark/unmark postings as cleared on a bank statement. */
  async setReconciled(dto: ReconcileDto) {
    return this.tenantTx.run(async (m) => {
      const res = (await m.query(
        `UPDATE finance_journal_entry
            SET reconciled = $1,
                reconciled_at = CASE WHEN $1 THEN COALESCE($2::date, current_date) ELSE NULL END
          WHERE id = ANY($3::uuid[])
          RETURNING id`,
        [dto.reconciled, dto.reconciledAt ?? null, dto.entryIds],
      )) as Row[];
      return { updated: res.length, reconciled: dto.reconciled };
    });
  }

  /**
   * Year-end close: zero every revenue & expense account as of the period end by posting a balanced
   * closing voucher (JV), with the net income rolled into a retained-earnings equity account.
   * Naturally idempotent — a second run finds the P&L already at zero and posts nothing.
   */
  async yearEndClose(dto: YearEndCloseDto) {
    const prep = await this.tenantTx.run(async (m) => {
      const periods = (await m.query(
        `SELECT id, name, end_date FROM finance_fiscal_period WHERE id=$1 AND deleted_at IS NULL`,
        [dto.periodId],
      )) as Array<{ id: string; name: string; end_date: string }>;
      const period = periods[0];
      if (!period) throw new NotFoundException('Period not found');
      const re = (await m.query(
        `SELECT type, is_group FROM finance_account WHERE id=$1 AND deleted_at IS NULL`,
        [dto.retainedEarningsAccountId],
      )) as Array<{ type: string; is_group: boolean }>;
      if (!re[0]) throw new BadRequestException('Retained-earnings account not found');
      if (re[0].type !== 'EQUITY' || re[0].is_group) {
        throw new UnprocessableEntityException('Retained earnings must be a postable EQUITY account');
      }
      const sums = await this.accountSums(m, period.end_date, ['REVENUE', 'EXPENSE']);
      return { period, sums };
    });

    // Build the closing entries: reverse each P&L account's raw balance to bring it to zero.
    let sumRaw = 0;
    const entries: Array<{ accountId: string; debitMinor?: number; creditMinor?: number }> = [];
    for (const a of prep.sums) {
      const raw = a.debit - a.credit; // debit-positive
      if (raw === 0) continue;
      entries.push(raw < 0 ? { accountId: a.id, debitMinor: -raw } : { accountId: a.id, creditMinor: raw });
      sumRaw += raw;
    }
    if (entries.length === 0) {
      return { posted: false, message: 'Nothing to close — revenue and expense are already zero', netIncomeMinor: 0 };
    }
    // Retained-earnings balancing leg absorbs the net (debit-credit contribution = sumRaw).
    entries.push(sumRaw > 0
      ? { accountId: dto.retainedEarningsAccountId, debitMinor: sumRaw }
      : { accountId: dto.retainedEarningsAccountId, creditMinor: -sumRaw });
    const netIncomeMinor = -sumRaw;

    const txn = (await this.createTransaction({
      description: `Year-end close: ${prep.period.name}`,
      voucherType: 'JV',
      occurredOn: prep.period.end_date,
      entries,
    } as CreateTransactionDto)) as { voucherNo?: string };
    return { posted: true, voucherNo: txn.voucherNo ?? null, netIncomeMinor, closedAccounts: entries.length - 1 };
  }

  // ── Recurring vouchers ───────────────────────────────────────────────────────
  async createRecurring(dto: CreateRecurringDto) {
    try {
      assertBalanced(dto.entries);
    } catch (err) {
      if (err instanceof UnbalancedTransactionError) throw new UnprocessableEntityException(err.message);
      throw err;
    }
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO recurring_voucher (tenant_id, description, voucher_type, frequency, next_run_date, end_date, entries)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, description, voucher_type, frequency, next_run_date::text AS next_run_date, end_date::text AS end_date, active, entries`,
        [dto.description, dto.voucherType ?? 'JV', dto.frequency, dto.nextRunDate, dto.endDate ?? null, JSON.stringify(dto.entries)],
      )) as Row[];
      return mapRecurring(rows[0]!);
    });
  }

  async listRecurring() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, description, voucher_type, frequency, next_run_date::text AS next_run_date, end_date::text AS end_date, active, entries
           FROM recurring_voucher WHERE deleted_at IS NULL ORDER BY active DESC, next_run_date`,
      )) as Row[];
      return rows.map(mapRecurring);
    });
  }

  /** Generate one voucher from a recurring template and advance its schedule. */
  async runRecurring(id: string) {
    const tpl = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, description, voucher_type, frequency, next_run_date::text AS next_run_date, end_date, active, entries
           FROM recurring_voucher WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      return rows[0];
    });
    if (!tpl) throw new NotFoundException('Recurring voucher not found');
    if (!tpl.active) throw new UnprocessableEntityException('Recurring voucher is not active');

    const entries = (tpl.entries as Array<{ accountId: string; debitMinor?: number; creditMinor?: number; costCenterId?: string }>);
    const occurredOn = String(tpl.next_run_date).slice(0, 10); // next_run_date is selected ::text (YYYY-MM-DD)
    const txn = (await this.createTransaction({
      description: tpl.description as string,
      voucherType: tpl.voucher_type as string,
      occurredOn,
      entries,
    } as CreateTransactionDto)) as { voucherNo?: string };

    const interval = frequencyInterval(tpl.frequency as Frequency);
    const updated = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE recurring_voucher
            SET next_run_date = (next_run_date + $2::interval)::date,
                active = CASE WHEN end_date IS NOT NULL AND (next_run_date + $2::interval)::date > end_date THEN false ELSE active END,
                updated_at = now()
          WHERE id=$1
          RETURNING next_run_date::text AS next_run_date, active`,
        [id, interval],
      )) as Row[];
      return rows[0]!;
    });
    return { voucherNo: txn.voucherNo ?? null, occurredOn, nextRunDate: updated.next_run_date, active: updated.active };
  }

  /** Generate vouchers for every active template whose next run is due (≤ today). */
  async runDue() {
    const due = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id FROM recurring_voucher
          WHERE deleted_at IS NULL AND active = true AND next_run_date <= current_date
            AND (end_date IS NULL OR next_run_date <= end_date)`,
      )) as Array<{ id: string }>;
      return rows.map((r) => r.id);
    });
    const generated: Array<{ id: string; voucherNo: string | null }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of due) {
      try {
        const r = await this.runRecurring(id);
        generated.push({ id, voucherNo: r.voucherNo });
      } catch (err) {
        skipped.push({ id, reason: err instanceof Error ? err.message : 'error' });
      }
    }
    return { generated: generated.length, vouchers: generated, skipped };
  }

  // ── Multi-currency (currencies, exchange rates, conversion) ──────────────────
  async createCurrency(dto: CreateCurrencyDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO currency (tenant_id, code, name, symbol, is_base)
           VALUES (current_setting('app.tenant_id')::uuid, upper($1), $2, $3, $4)
           RETURNING id, code, name, symbol, is_base, active`,
          [dto.code, dto.name, dto.symbol ?? null, dto.isBase ?? false],
        )) as Row[];
        return mapCurrency(rows[0]!);
      } catch (err) {
        if (isUnique(err)) {
          const e = err as { constraint?: string };
          if (e.constraint === 'uq_currency_one_base') throw new BadRequestException('A base currency already exists');
          throw new BadRequestException(`Currency "${dto.code}" already exists`);
        }
        throw err;
      }
    });
  }

  async listCurrencies() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, code, name, symbol, is_base, active FROM currency WHERE deleted_at IS NULL ORDER BY is_base DESC, code`,
      )) as Row[];
      return rows.map(mapCurrency);
    });
  }

  async setRate(dto: SetRateDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO exchange_rate (tenant_id, currency_code, rate_micro, as_of)
         VALUES (current_setting('app.tenant_id')::uuid, upper($1), $2, COALESCE($3::date, current_date))
         RETURNING id, currency_code, rate_micro, as_of::text AS as_of`,
        [dto.currencyCode, rateToMicro(dto.rate), dto.asOf ?? null],
      )) as Row[];
      return mapRate(rows[0]!);
    });
  }

  async listRates() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, currency_code, rate_micro, as_of::text AS as_of FROM exchange_rate
          WHERE deleted_at IS NULL ORDER BY currency_code, as_of DESC`,
      )) as Row[];
      return rows.map(mapRate);
    });
  }

  /** Latest base-rate (×1e6) for a currency at a date; base currency = 1e6. Throws if no rate. */
  private async rateMicroAt(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    code: string,
    asOf?: string,
  ): Promise<number> {
    const cur = (await m.query(
      `SELECT is_base FROM currency WHERE lower(code)=lower($1) AND deleted_at IS NULL`,
      [code],
    )) as Array<{ is_base: boolean }>;
    if (cur[0]?.is_base) return RATE_SCALE;
    const r = (await m.query(
      `SELECT rate_micro FROM exchange_rate
        WHERE lower(currency_code)=lower($1) AND deleted_at IS NULL AND ($2::date IS NULL OR as_of <= $2::date)
        ORDER BY as_of DESC, created_at DESC LIMIT 1`,
      [code, asOf ?? null],
    )) as Array<{ rate_micro: string }>;
    if (!r[0]) throw new BadRequestException(`No exchange rate for ${code.toUpperCase()}`);
    return Number(r[0].rate_micro);
  }

  async convert(query: ConvertQueryDto) {
    return this.tenantTx.run(async (m) => {
      const fromMicro = await this.rateMicroAt(m, query.from, query.asOf);
      const toMicro = await this.rateMicroAt(m, query.to, query.asOf);
      const resultMinor = convertViaBase(query.amountMinor, fromMicro, toMicro);
      return {
        from: query.from.toUpperCase(),
        to: query.to.toUpperCase(),
        asOf: query.asOf ?? null,
        amount: { amountMinor: query.amountMinor, currency: query.from.toUpperCase() },
        result: { amountMinor: resultMinor, currency: query.to.toUpperCase() },
        fromRate: microToRate(fromMicro),
        toRate: microToRate(toMicro),
      };
    });
  }

  /**
   * Period-end FX revaluation. Every account that carries a foreign-currency balance is restated to its
   * current base value: `gain/loss = fc_balance × current_rate − booked_base_balance`. One balancing JV
   * adjusts each account and books the net unrealised gain/loss to `fxAccountId`. Posting only the delta
   * since the last revaluation makes a re-run at the same rate a no-op (idempotent on a flat market).
   */
  async revalueForeign(dto: RevalueFxDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT je.account_id,
                max(je.fc_currency) AS fc_currency,
                COALESCE(SUM(CASE WHEN je.debit_minor > 0 THEN je.fc_amount_minor ELSE -je.fc_amount_minor END), 0) AS fc_balance,
                -- base_balance is the account's FULL posted balance (including prior revaluation
                -- adjustments, which carry no fc_currency) — not just the foreign-tagged lines.
                (SELECT COALESCE(SUM(a.debit_minor - a.credit_minor), 0)
                   FROM finance_journal_entry a
                   JOIN finance_transaction at2 ON at2.id = a.transaction_id AND at2.status = 'POSTED' AND at2.deleted_at IS NULL
                  WHERE a.account_id = je.account_id AND a.deleted_at IS NULL) AS base_balance
           FROM finance_journal_entry je
           JOIN finance_transaction t ON t.id = je.transaction_id AND t.status = 'POSTED' AND t.deleted_at IS NULL
          WHERE je.fc_currency IS NOT NULL AND je.deleted_at IS NULL
          GROUP BY je.account_id`,
      )) as Array<{ account_id: string; fc_currency: string; fc_balance: string; base_balance: string }>;

      const lines: Array<{ accountId: string; debitMinor?: number; creditMinor?: number }> = [];
      const adjustments: Array<{ accountId: string; currency: string; diffMinor: number }> = [];
      let net = 0;
      for (const r of rows) {
        const rate = await this.rateMicroAt(m, r.fc_currency, dto.asOf);
        const revalued = Math.round((Number(r.fc_balance) * rate) / RATE_SCALE);
        const diff = revalued - Number(r.base_balance); // base minor; signed (handles asset & liability)
        if (diff === 0) continue;
        lines.push(diff > 0 ? { accountId: r.account_id, debitMinor: diff } : { accountId: r.account_id, creditMinor: -diff });
        adjustments.push({ accountId: r.account_id, currency: r.fc_currency, diffMinor: diff });
        net += diff;
      }

      if (lines.length === 0) {
        return { posted: false, fxGainLossMinor: 0, accountsRevalued: 0, adjustments };
      }
      // Balance the voucher against the FX gain/loss account. net>0 ⇒ a credit (gain); net<0 ⇒ a debit (loss).
      lines.push(net > 0 ? { accountId: dto.fxAccountId, creditMinor: net } : { accountId: dto.fxAccountId, debitMinor: -net });

      const txn = await this.postInTx(m, { description: 'FX revaluation', voucherType: 'JV', occurredOn: dto.asOf, entries: lines });
      return { posted: true, voucherNo: txn.voucherNo, fxGainLossMinor: net, accountsRevalued: adjustments.length, adjustments };
    });
  }

  // ── Accounts Payable (vendors / bills / payments) ────────────────────────────
  async createVendor(dto: CreateVendorDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO vendor (tenant_id, name, email, phone)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)
         RETURNING id, name, email, phone`,
        [dto.name, dto.email ?? null, dto.phone ?? null],
      )) as Row[];
      const vendor = rows[0]!;
      // Subsidiary ledger: if a Payables CONTROL group is configured, give the vendor its own
      // sub-account under it so it shows in (and posts through) the chart of accounts.
      const acct = await this.ensureSubAccount(m, 'PAYABLE', vendor.name as string);
      if (acct) {
        await m.query(`UPDATE vendor SET account_id=$1, updated_at=now() WHERE id=$2`, [acct.id, vendor.id]);
      }
      return mapVendor({ ...vendor, account_id: acct?.id ?? null, account_code: acct?.code ?? null, account_name: acct?.name ?? null });
    });
  }

  /**
   * Create a leaf ledger account for a subsidiary (vendor/customer) under the tenant's PAYABLE /
   * RECEIVABLE control group, if one is configured. Returns the new account, or null when no control
   * group exists or it is already at the 4-level cap.
   */
  private async ensureSubAccount(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    control: 'PAYABLE' | 'RECEIVABLE',
    name: string,
  ): Promise<{ id: string; code: string; name: string } | null> {
    const ctrlRows = (await m.query(
      `SELECT id, code, type, level FROM finance_account
        WHERE control_type=$1 AND is_group=true AND deleted_at IS NULL
        ORDER BY level DESC LIMIT 1`,
      [control],
    )) as Array<{ id: string; code: string; type: string; level: number }>;
    const ctrl = ctrlRows[0];
    if (!ctrl || Number(ctrl.level) >= MAX_ACCOUNT_LEVELS) return null;
    const cnt = (await m.query(
      `SELECT count(*)::int AS c FROM finance_account WHERE parent_id=$1 AND deleted_at IS NULL`,
      [ctrl.id],
    )) as Array<{ c: number }>;
    const code = `${ctrl.code}-${String(Number(cnt[0]?.c ?? 0) + 1).padStart(4, '0')}`;
    const acc = (await m.query(
      `INSERT INTO finance_account (tenant_id, code, name, type, parent_id, is_group, level)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, false, $5)
       RETURNING id, code, name`,
      [code, name, ctrl.type, ctrl.id, Number(ctrl.level) + 1],
    )) as Array<{ id: string; code: string; name: string }>;
    return acc[0]!;
  }

  async listVendors() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT v.id, v.name, v.email, v.phone, v.account_id, a.code AS account_code, a.name AS account_name
           FROM vendor v LEFT JOIN finance_account a ON a.id = v.account_id
          WHERE v.deleted_at IS NULL ORDER BY v.name`,
      )) as Row[];
      return rows.map(mapVendor);
    });
  }

  // ── Customers (AR subsidiary) ────────────────────────────────────────────────
  async createCustomer(dto: CreateCustomerDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO customer (tenant_id, name, email, phone)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)
         RETURNING id, name, email, phone`,
        [dto.name, dto.email ?? null, dto.phone ?? null],
      )) as Row[];
      const customer = rows[0]!;
      // Subsidiary ledger: if a Receivables CONTROL group is configured, give the customer its own
      // sub-account under it so it shows in (and posts through) the chart of accounts.
      const acct = await this.ensureSubAccount(m, 'RECEIVABLE', customer.name as string);
      if (acct) {
        await m.query(`UPDATE customer SET account_id=$1, updated_at=now() WHERE id=$2`, [acct.id, customer.id]);
      }
      return mapCustomer({ ...customer, account_id: acct?.id ?? null, account_code: acct?.code ?? null, account_name: acct?.name ?? null });
    });
  }

  async listCustomers() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT c.id, c.name, c.email, c.phone, c.account_id, a.code AS account_code, a.name AS account_name
           FROM customer c LEFT JOIN finance_account a ON a.id = c.account_id
          WHERE c.deleted_at IS NULL ORDER BY c.name`,
      )) as Row[];
      return rows.map(mapCustomer);
    });
  }

  /** The customer's receivable ledger account, created under the RECEIVABLE control if not yet linked. */
  private async customerReceivableAccount(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    customerId: string,
  ): Promise<string> {
    const c = (await m.query(
      `SELECT account_id, name FROM customer WHERE id=$1 AND deleted_at IS NULL`,
      [customerId],
    )) as Array<{ account_id: string | null; name: string }>;
    if (!c[0]) throw new BadRequestException('Customer not found in this tenant');
    if (c[0].account_id) return c[0].account_id;
    const acc = await this.ensureSubAccount(m, 'RECEIVABLE', c[0].name);
    if (!acc) throw new UnprocessableEntityException('No Receivables control account configured — designate one first');
    await m.query(`UPDATE customer SET account_id=$1, updated_at=now() WHERE id=$2`, [acc.id, customerId]);
    return acc.id;
  }

  async createBill(dto: CreateBillDto) {
    const totals = computeInvoiceTotals(dto.lineItems, dto.taxMinor ?? 0);
    const currency = dto.currency ?? 'PKR';
    const lines = dto.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.quantity * l.unitPriceMinor,
    }));
    return this.tenantTx.run(async (m) => {
      let bill: Row;
      try {
        const rows = (await m.query(
          `INSERT INTO vendor_bill
             (tenant_id, number, vendor_id, line_items, subtotal_minor, tax_minor, total_minor, currency, bill_date, due_date)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3::jsonb, $4, $5, $6, $7, COALESCE($8::date, current_date), $9)
           RETURNING id, number, vendor_id, line_items, subtotal_minor, tax_minor, total_minor, amount_paid_minor, currency, status, bill_date::text AS bill_date, due_date::text AS due_date`,
          [dto.number, dto.vendorId, JSON.stringify(lines), totals.subtotalMinor, totals.taxMinor, totals.totalMinor, currency, dto.billDate ?? null, dto.dueDate ?? null],
        )) as Row[];
        bill = rows[0]!;
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Bill number "${dto.number}" already exists`);
        if (isForeignKey(err)) throw new BadRequestException('Vendor does not exist in this tenant');
        throw err;
      }

      // Optional GL posting: Dr expense / Cr the vendor's payable account (atomic with the bill).
      let journalNo: string | null = null;
      if (dto.expenseAccountId) {
        const payable = await this.vendorPayableAccount(m, dto.vendorId);
        const txn = await this.postInTx(m, {
          description: `Bill ${bill.number} — purchase`,
          voucherType: 'JV',
          occurredOn: String(bill.bill_date).slice(0, 10),
          entries: [
            { accountId: dto.expenseAccountId, debitMinor: totals.totalMinor },
            { accountId: payable, creditMinor: totals.totalMinor },
          ],
        } as CreateTransactionDto);
        await m.query(`UPDATE vendor_bill SET journal_id=$1 WHERE id=$2`, [txn.id, bill.id]);
        journalNo = (txn.voucherNo ?? null) as string | null;
      }
      return { ...mapBill(bill), journalNo };
    });
  }

  /** The vendor's linked payable ledger account — required to post AP to the GL. */
  private async vendorPayableAccount(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    vendorId: string,
  ): Promise<string> {
    const v = (await m.query(`SELECT account_id FROM vendor WHERE id=$1 AND deleted_at IS NULL`, [vendorId])) as Array<{ account_id: string | null }>;
    const acc = v[0]?.account_id;
    if (!acc) {
      throw new UnprocessableEntityException('This vendor has no payable ledger account — configure a Payables control account first');
    }
    return acc;
  }

  async listBills(query: ListBillsQueryDto): Promise<SuccessEnvelope<unknown[]>> {
    const { page, pageSize, limit, offset } = normalizePagination(query.page, query.pageSize);
    const conditions = ['b.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (query.status) conditions.push(`b.status = $${params.push(query.status)}`);
    if (query.vendorId) conditions.push(`b.vendor_id = $${params.push(query.vendorId)}`);
    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT b.id, b.number, b.vendor_id, v.name AS vendor_name, b.subtotal_minor, b.tax_minor,
                b.total_minor, b.amount_paid_minor, b.currency, b.status, b.bill_date, b.due_date
           FROM vendor_bill b
           LEFT JOIN vendor v ON v.id = b.vendor_id
           ${where}
          ORDER BY b.bill_date DESC, b.created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      )) as Row[];
      const count = (await m.query(`SELECT count(*)::int AS total FROM vendor_bill b ${where}`, params)) as Array<{ total: number }>;
      return {
        data: rows.map(mapBill),
        meta: { pagination: paginationMeta(count[0]?.total ?? 0, page, pageSize) },
      };
    });
  }

  async getBill(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT b.id, b.number, b.vendor_id, v.name AS vendor_name, b.line_items, b.subtotal_minor, b.tax_minor,
                b.total_minor, b.amount_paid_minor, b.currency, b.status, b.bill_date, b.due_date
           FROM vendor_bill b LEFT JOIN vendor v ON v.id = b.vendor_id
          WHERE b.id=$1 AND b.deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Bill not found');
      const payments = (await m.query(
        `SELECT id, amount_minor, paid_on, method FROM bill_payment WHERE bill_id=$1 ORDER BY paid_on, created_at`,
        [id],
      )) as Row[];
      return { ...mapBill(rows[0]), payments: payments.map((p) => ({ id: p.id, amount: money(p.amount_minor), paidOn: p.paid_on, method: p.method ?? null })) };
    });
  }

  /** Record a payment against a bill; updates amount paid + status (PARTIALLY_PAID / PAID). */
  async payBill(id: string, dto: CreateBillPaymentDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, vendor_id, total_minor, amount_paid_minor, status FROM vendor_bill WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )) as Array<{ id: string; vendor_id: string; total_minor: string; amount_paid_minor: string; status: string }>;
      const bill = rows[0];
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.status === 'VOID') throw new UnprocessableEntityException('Cannot pay a void bill');
      const total = Number(bill.total_minor);
      const newPaid = Number(bill.amount_paid_minor) + dto.amountMinor;
      if (newPaid > total) throw new UnprocessableEntityException('Payment exceeds the outstanding amount');
      const pmt = (await m.query(
        `INSERT INTO bill_payment (tenant_id, bill_id, amount_minor, paid_on, method)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, COALESCE($3::date, current_date), $4)
         RETURNING id, paid_on::text AS paid_on`,
        [id, dto.amountMinor, dto.paidOn ?? null, dto.method ?? null],
      )) as Array<{ id: string; paid_on: string }>;
      const status = newPaid >= total ? 'PAID' : 'PARTIALLY_PAID';
      await m.query(`UPDATE vendor_bill SET amount_paid_minor=$1, status=$2, updated_at=now() WHERE id=$3`, [newPaid, status, id]);

      // Optional GL posting: Dr the vendor's payable / Cr the cash·bank account (atomic with the payment).
      let journalNo: string | null = null;
      if (dto.paymentAccountId) {
        const payable = await this.vendorPayableAccount(m, bill.vendor_id);
        const pa = (await m.query(`SELECT control_type FROM finance_account WHERE id=$1 AND deleted_at IS NULL`, [dto.paymentAccountId])) as Array<{ control_type: ControlType }>;
        const ctrl = pa[0]?.control_type ?? 'NONE';
        const voucherType: VoucherType = ctrl === 'BANK' ? 'BPV' : ctrl === 'CASH' ? 'CPV' : 'JV';
        const txn = await this.postInTx(m, {
          description: `Payment of bill ${id}`,
          voucherType,
          occurredOn: String(pmt[0]!.paid_on).slice(0, 10),
          entries: [
            { accountId: payable, debitMinor: dto.amountMinor },
            { accountId: dto.paymentAccountId, creditMinor: dto.amountMinor },
          ],
        } as CreateTransactionDto);
        await m.query(`UPDATE bill_payment SET journal_id=$1 WHERE id=$2`, [txn.id, pmt[0]!.id]);
        journalNo = (txn.voucherNo ?? null) as string | null;
      }
      return { id, status, amountPaid: money(newPaid), outstanding: money(total - newPaid), journalNo };
    });
  }

  /** Accounts-payable aging: unpaid bill balances bucketed by days past due. */
  async apAging(query: AsOfQueryDto) {
    return this.tenantTx.run(async (m) => {
      const asOf = query.asOf ? new Date(query.asOf) : new Date();
      const rows = (await m.query(
        `SELECT b.id, b.number, b.vendor_id, v.name AS vendor_name, b.currency, b.due_date, b.bill_date,
                (b.total_minor - b.amount_paid_minor) AS outstanding_minor
           FROM vendor_bill b LEFT JOIN vendor v ON v.id = b.vendor_id
          WHERE b.deleted_at IS NULL AND b.status NOT IN ('PAID','VOID') AND (b.total_minor - b.amount_paid_minor) > 0`,
      )) as Row[];
      const totals: Record<AgingBucket | 'total', number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
      const bills = rows.map((r) => {
        const due = new Date((r.due_date ?? r.bill_date) as string);
        const daysPastDue = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
        const bucket = agingBucket(daysPastDue);
        const amountMinor = Number(r.outstanding_minor);
        totals[bucket] += amountMinor;
        totals.total += amountMinor;
        return {
          billId: r.id,
          number: r.number,
          vendorId: r.vendor_id,
          vendorName: r.vendor_name ?? null,
          dueDate: r.due_date ?? r.bill_date,
          daysPastDue,
          bucket,
          amount: money(amountMinor, r.currency as string),
        };
      });
      return { asOf: query.asOf ?? null, buckets: [...AGING_BUCKETS], totals, bills };
    });
  }

  // ── Invoices ───────────────────────────────────────────────────────────────
  async createInvoice(dto: CreateInvoiceDto) {
    const totals = computeInvoiceTotals(dto.lineItems, dto.taxMinor ?? 0);
    const currency = dto.currency ?? 'PKR';
    const lines = dto.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.quantity * l.unitPriceMinor,
    }));
    return this.tenantTx.run(async (m) => {
      let inv: Row;
      try {
        const rows = (await m.query(
          `INSERT INTO finance_invoice
             (tenant_id, number, customer_id, client_id, line_items, subtotal_minor, tax_minor, total_minor, currency, due_date)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
           RETURNING id, number, customer_id, client_id, line_items, subtotal_minor, tax_minor, total_minor, currency, status, due_date::text AS due_date`,
          [
            dto.number,
            dto.customerId ?? null,
            dto.clientId ?? null,
            JSON.stringify(lines),
            totals.subtotalMinor,
            totals.taxMinor,
            totals.totalMinor,
            currency,
            dto.dueDate ?? null,
          ],
        )) as Row[];
        inv = rows[0]!;
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Invoice number "${dto.number}" already exists`);
        if (isForeignKey(err)) throw new BadRequestException('Customer or client not found in this tenant');
        throw err;
      }

      // Optional GL posting: Dr the customer/client receivable / Cr the income account (atomic with the invoice).
      let journalNo: string | null = null;
      if (dto.incomeAccountId) {
        if (!dto.customerId && !dto.clientId) throw new UnprocessableEntityException('Posting an invoice to the GL needs a customer');
        const receivable = dto.customerId
          ? await this.customerReceivableAccount(m, dto.customerId)
          : await this.ensureClientReceivable(m, dto.clientId!);
        const txn = await this.postInTx(m, {
          description: `Invoice ${inv.number}`,
          voucherType: 'JV',
          entries: [
            { accountId: receivable, debitMinor: totals.totalMinor },
            { accountId: dto.incomeAccountId, creditMinor: totals.totalMinor },
          ],
        } as CreateTransactionDto);
        await m.query(`UPDATE finance_invoice SET journal_id=$1 WHERE id=$2`, [txn.id, inv.id]);
        journalNo = (txn.voucherNo ?? null) as string | null;
      }
      return { ...mapInvoice(inv), journalNo };
    });
  }

  /** The client's receivable ledger account, created lazily under the RECEIVABLE control on first use. */
  private async ensureClientReceivable(
    m: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    clientId: string,
  ): Promise<string> {
    const c = (await m.query(
      `SELECT account_id, company_name FROM crm_client WHERE id=$1 AND deleted_at IS NULL`,
      [clientId],
    )) as Array<{ account_id: string | null; company_name: string }>;
    if (!c[0]) throw new BadRequestException('Client not found in this tenant');
    if (c[0].account_id) return c[0].account_id;
    const acc = await this.ensureSubAccount(m, 'RECEIVABLE', c[0].company_name);
    if (!acc) throw new UnprocessableEntityException('No Receivables control account configured — designate one first');
    await m.query(`UPDATE crm_client SET account_id=$1, updated_at=now() WHERE id=$2`, [acc.id, clientId]);
    return acc.id;
  }

  async listInvoices(query: ListInvoicesQueryDto): Promise<SuccessEnvelope<unknown[]>> {
    const { page, pageSize, limit, offset } = normalizePagination(query.page, query.pageSize);
    // Conditions are prefixed `i.` so they resolve against the invoice alias in the customer join below.
    const conditions = ['i.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (query.status) conditions.push(`i.status = $${params.push(query.status)}`);
    if (query.clientId) conditions.push(`i.client_id = $${params.push(query.clientId)}`);
    if (query.customerId) conditions.push(`i.customer_id = $${params.push(query.customerId)}`);
    if (query.from) conditions.push(`i.created_at::date >= $${params.push(query.from)}`);
    if (query.to) conditions.push(`i.created_at::date <= $${params.push(query.to)}`);
    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT i.id, i.number, i.customer_id, i.client_id, c.name AS customer_name, i.line_items, i.subtotal_minor, i.tax_minor, i.total_minor, i.currency, i.status, i.due_date
         FROM finance_invoice i LEFT JOIN customer c ON c.id = i.customer_id
         ${where} ORDER BY i.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      )) as Row[];
      const count = (await m.query(`SELECT count(*)::int AS total FROM finance_invoice i ${where}`, params)) as Array<{
        total: number;
      }>;
      return {
        data: rows.map(mapInvoice),
        meta: { pagination: paginationMeta(count[0]?.total ?? 0, page, pageSize) },
      };
    });
  }

  async getInvoice(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT i.id, i.number, i.customer_id, i.client_id, c.name AS customer_name, i.line_items, i.subtotal_minor, i.tax_minor, i.total_minor, i.currency, i.status, i.due_date
         FROM finance_invoice i LEFT JOIN customer c ON c.id = i.customer_id
         WHERE i.id=$1 AND i.deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Invoice not found');
      return mapInvoice(rows[0]);
    });
  }

  /** Mark an invoice paid and emit `finance.invoice_paid` to the OUTBOX in the same transaction. */
  async payInvoice(id: string, dto: PayInvoiceDto = {}) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, number, customer_id, client_id, total_minor, currency, status FROM finance_invoice WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Invoice not found');
      let journalNo: string | null = null;
      if (inv.status !== 'PAID') {
        await m.query(`UPDATE finance_invoice SET status='PAID', paid_at=now(), updated_at=now() WHERE id=$1`, [id]);
        await this.outbox.write(m, EVENT_TYPES.FINANCE_INVOICE_PAID, {
          invoiceId: inv.id,
          number: inv.number,
          customerId: inv.customer_id,
          clientId: inv.client_id,
          totalMinor: Number(inv.total_minor),
          currency: inv.currency,
        });

        // Optional GL posting: Dr cash·bank / Cr the customer/client receivable (atomic with the receipt).
        if (dto.paymentAccountId) {
          if (!inv.customer_id && !inv.client_id) throw new UnprocessableEntityException('Posting a receipt to the GL needs a customer');
          const receivable = inv.customer_id
            ? await this.customerReceivableAccount(m, inv.customer_id as string)
            : await this.ensureClientReceivable(m, inv.client_id as string);
          const pa = (await m.query(`SELECT control_type FROM finance_account WHERE id=$1 AND deleted_at IS NULL`, [dto.paymentAccountId])) as Array<{ control_type: ControlType }>;
          const ctrl = pa[0]?.control_type ?? 'NONE';
          const voucherType: VoucherType = ctrl === 'BANK' ? 'BRV' : ctrl === 'CASH' ? 'CRV' : 'JV';
          const txn = await this.postInTx(m, {
            description: `Receipt of invoice ${inv.number}`,
            voucherType,
            entries: [
              { accountId: dto.paymentAccountId, debitMinor: Number(inv.total_minor) },
              { accountId: receivable, creditMinor: Number(inv.total_minor) },
            ],
          } as CreateTransactionDto);
          journalNo = (txn.voucherNo ?? null) as string | null;
        }
      }
      return { id: inv.id, number: inv.number, status: 'PAID', journalNo };
    });
  }
}

/** Money envelope for report payloads (integer minor units + currency, ADR-007). */
function money(v: unknown, currency = 'PKR') {
  return { amountMinor: Number(v), currency };
}

function mapAccount(r: Row) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    parentId: r.parent_id ?? null,
    isGroup: r.is_group ?? false,
    controlType: r.control_type ?? 'NONE',
    bankName: r.bank_name ?? null,
    accountNumber: r.account_number ?? null,
    currency: r.currency ?? null,
    ...(r.level !== undefined ? { level: Number(r.level) } : {}),
  };
}

function mapCurrency(r: Row) {
  return { id: r.id, code: r.code, name: r.name, symbol: r.symbol ?? null, isBase: r.is_base, active: r.active };
}

function mapRate(r: Row) {
  return { id: r.id, currencyCode: r.currency_code, rate: microToRate(Number(r.rate_micro)), asOf: r.as_of };
}

function mapRecurring(r: Row) {
  return {
    id: r.id,
    description: r.description,
    voucherType: r.voucher_type,
    frequency: r.frequency,
    nextRunDate: r.next_run_date,
    endDate: r.end_date ?? null,
    active: r.active,
    entries: r.entries,
  };
}

function mapCostCenter(r: Row) {
  return { id: r.id, code: r.code, name: r.name, active: r.active ?? true };
}

function mapVendor(r: Row) {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? null,
    phone: r.phone ?? null,
    accountId: r.account_id ?? null,
    accountCode: r.account_code ?? null,
    accountName: r.account_name ?? null,
  };
}

function mapBill(r: Row) {
  const currency = r.currency as string;
  const money_ = (v: unknown) => ({ amountMinor: Number(v), currency });
  const total = Number(r.total_minor);
  const paid = Number(r.amount_paid_minor);
  return {
    id: r.id,
    number: r.number,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name ?? null,
    ...(r.line_items !== undefined ? { lineItems: r.line_items } : {}),
    subtotal: money_(r.subtotal_minor),
    tax: money_(r.tax_minor),
    total: money_(total),
    paid: money_(paid),
    outstanding: money_(total - paid),
    status: r.status,
    billDate: r.bill_date ?? null,
    dueDate: r.due_date ?? null,
  };
}

function mapPeriod(r: Row) {
  return {
    id: r.id,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
  };
}

function mapInvoice(r: Row) {
  const currency = r.currency as string;
  const money = (v: unknown) => ({ amountMinor: Number(v), currency });
  return {
    id: r.id,
    number: r.number,
    customerId: r.customer_id ?? null,
    customerName: r.customer_name ?? null,
    clientId: r.client_id ?? null,
    lineItems: r.line_items,
    subtotal: money(r.subtotal_minor),
    tax: money(r.tax_minor),
    total: money(r.total_minor),
    status: r.status,
    dueDate: r.due_date ?? null,
  };
}

function mapCustomer(r: Row) {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? null,
    phone: r.phone ?? null,
    accountId: r.account_id ?? null,
    accountCode: r.account_code ?? null,
    accountName: r.account_name ?? null,
  };
}

function isUnique(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}
function isForeignKey(err: unknown): boolean {
  return (err as { code?: string })?.code === '23503';
}
