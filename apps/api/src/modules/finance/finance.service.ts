import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EVENT_TYPES, type SuccessEnvelope, paginationMeta } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import { normalizePagination } from '../hr/hr.util';
import type {
  AsOfQueryDto,
  CashBookQueryDto,
  CreateAccountDto,
  CreateInvoiceDto,
  CreatePeriodDto,
  CreateTransactionDto,
  LedgerQueryDto,
  ListInvoicesQueryDto,
  ListTransactionsQueryDto,
  PeriodQueryDto,
  UpdateAccountDto,
  UpdatePeriodDto,
} from './dto/finance.dto';
import {
  type AccountType,
  type ControlType,
  MAX_ACCOUNT_LEVELS,
  UnbalancedTransactionError,
  type VoucherType,
  VoucherValidationError,
  assertBalanced,
  assertVoucherType,
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
      if (controlType !== 'NONE' && isGroup) {
        throw new UnprocessableEntityException('Only a postable (non-group) account can be a cash/bank account');
      }
      try {
        const rows = (await m.query(
          `INSERT INTO finance_account (tenant_id, code, name, type, parent_id, is_group, level, control_type, bank_name, account_number)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, code, name, type, parent_id, is_group, level, control_type, bank_name, account_number`,
          [dto.code, dto.name, type, dto.parentId ?? null, isGroup, level, controlType, dto.bankName ?? null, dto.accountNumber ?? null],
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
      if (dto.controlType && dto.controlType !== 'NONE' && existing[0].is_group) {
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
         RETURNING id, code, name, type, parent_id, is_group, level, control_type, bank_name, account_number`,
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
          SELECT id, code, name, type, parent_id, is_group, control_type, bank_name, account_number, 1 AS level, ARRAY[code] AS path
            FROM finance_account
           WHERE deleted_at IS NULL AND parent_id IS NULL
          UNION ALL
          SELECT c.id, c.code, c.name, c.type, c.parent_id, c.is_group, c.control_type, c.bank_name, c.account_number, t.level + 1, t.path || c.code
            FROM finance_account c
            JOIN tree t ON c.parent_id = t.id
           WHERE c.deleted_at IS NULL
        )
        SELECT id, code, name, type, parent_id, is_group, control_type, bank_name, account_number, level FROM tree ORDER BY path
      `)) as Row[];
      return rows.map(mapAccount);
    });
  }

  // ── Transactions (double-entry) ─────────────────────────────────────────────
  async createTransaction(dto: CreateTransactionDto) {
    let totals: { debit: number; credit: number };
    try {
      totals = assertBalanced(dto.entries);
    } catch (err) {
      if (err instanceof UnbalancedTransactionError) throw new UnprocessableEntityException(err.message);
      throw err;
    }

    return this.tenantTx.run(async (m) => {
      // Postings are only allowed to leaf (non-group) accounts that exist in this tenant.
      const ids = [...new Set(dto.entries.map((e) => e.accountId))];
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
          dto.entries.map((e) => ({
            controlType: controlById.get(e.accountId) ?? 'NONE',
            debitMinor: e.debitMinor ?? 0,
            creditMinor: e.creditMinor ?? 0,
          })),
        );
      } catch (err) {
        if (err instanceof VoucherValidationError) throw new UnprocessableEntityException(err.message);
        throw err;
      }

      // Period lock: once fiscal periods exist, the date must fall inside an OPEN one.
      await this.assertOpenPeriod(m, dto.occurredOn);

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
        `INSERT INTO finance_transaction (tenant_id, description, voucher_type, voucher_no, occurred_on, reference)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, COALESCE($4::date, current_date), $5)
         RETURNING id, description, voucher_type, voucher_no, occurred_on, reference`,
        [dto.description, voucherType, voucherNo, dto.occurredOn ?? null, dto.reference ?? null],
      )) as Row[];
      const txn = txRows[0]!;
      try {
        for (const e of dto.entries) {
          await m.query(
            `INSERT INTO finance_journal_entry (tenant_id, transaction_id, account_id, debit_minor, credit_minor)
             VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4)`,
            [txn.id, e.accountId, e.debitMinor ?? 0, e.creditMinor ?? 0],
          );
        }
      } catch (err) {
        if (isForeignKey(err)) throw new BadRequestException('One or more accounts do not exist in this tenant');
        throw err;
      }
      return {
        id: txn.id,
        description: txn.description,
        voucherType: txn.voucher_type,
        voucherNo: txn.voucher_no,
        occurredOn: txn.occurred_on,
        reference: txn.reference,
        totalDebitMinor: totals.debit,
        totalCreditMinor: totals.credit,
        entries: dto.entries,
      };
    });
  }

  async getTransaction(id: string) {
    return this.tenantTx.run(async (m) => {
      const tx = (await m.query(
        `SELECT id, description, voucher_type, voucher_no, occurred_on, reference FROM finance_transaction WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!tx[0]) throw new NotFoundException('Transaction not found');
      const entries = (await m.query(
        `SELECT id, account_id, debit_minor, credit_minor, currency FROM finance_journal_entry WHERE transaction_id=$1 ORDER BY created_at`,
        [id],
      )) as Row[];
      return { ...tx[0], entries };
    });
  }

  /** Reverse a voucher with a contra entry (debits↔credits), linked for the audit trail. */
  async reverseTransaction(id: string) {
    return this.tenantTx.run(async (m) => {
      const orig = (await m.query(
        `SELECT id, voucher_no, reversed_by_id FROM finance_transaction WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Array<{ id: string; voucher_no: string | null; reversed_by_id: string | null }>;
      if (!orig[0]) throw new NotFoundException('Transaction not found');
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
        `INSERT INTO finance_transaction (tenant_id, description, voucher_type, voucher_no, occurred_on, reverses_id)
         VALUES (current_setting('app.tenant_id')::uuid, $1, 'JV', $2, current_date, $3)
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
           LEFT JOIN finance_transaction t ON t.id = je.transaction_id AND t.deleted_at IS NULL
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
    if (query.from) conditions.push(`t.occurred_on >= $${params.push(query.from)}`);
    if (query.to) conditions.push(`t.occurred_on <= $${params.push(query.to)}`);
    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT t.id, t.description, t.voucher_type, t.voucher_no, t.occurred_on, t.reference,
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
            WHERE je.account_id=$1 AND t.deleted_at IS NULL AND t.occurred_on < $2`,
          [accountId, query.from],
        )) as Array<{ raw: string }>;
        openingRaw = Number(op[0]?.raw ?? 0);
      }

      const conditions = ['je.account_id = $1', 't.deleted_at IS NULL'];
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
    const conditions = ['a.deleted_at IS NULL', 'a.is_group = false', 't.deleted_at IS NULL'];
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
      try {
        const rows = (await m.query(
          `INSERT INTO finance_invoice
             (tenant_id, number, client_id, line_items, subtotal_minor, tax_minor, total_minor, currency, due_date)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3::jsonb, $4, $5, $6, $7, $8)
           RETURNING id, number, client_id, line_items, subtotal_minor, tax_minor, total_minor, currency, status, due_date`,
          [
            dto.number,
            dto.clientId ?? null,
            JSON.stringify(lines),
            totals.subtotalMinor,
            totals.taxMinor,
            totals.totalMinor,
            currency,
            dto.dueDate ?? null,
          ],
        )) as Row[];
        return mapInvoice(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Invoice number "${dto.number}" already exists`);
        throw err;
      }
    });
  }

  async listInvoices(query: ListInvoicesQueryDto): Promise<SuccessEnvelope<unknown[]>> {
    const { page, pageSize, limit, offset } = normalizePagination(query.page, query.pageSize);
    const conditions = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (query.status) conditions.push(`status = $${params.push(query.status)}`);
    if (query.clientId) conditions.push(`client_id = $${params.push(query.clientId)}`);
    if (query.from) conditions.push(`created_at::date >= $${params.push(query.from)}`);
    if (query.to) conditions.push(`created_at::date <= $${params.push(query.to)}`);
    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, number, client_id, line_items, subtotal_minor, tax_minor, total_minor, currency, status, due_date
         FROM finance_invoice ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      )) as Row[];
      const count = (await m.query(`SELECT count(*)::int AS total FROM finance_invoice ${where}`, params)) as Array<{
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
        `SELECT id, number, client_id, line_items, subtotal_minor, tax_minor, total_minor, currency, status, due_date
         FROM finance_invoice WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Invoice not found');
      return mapInvoice(rows[0]);
    });
  }

  /** Mark an invoice paid and emit `finance.invoice_paid` to the OUTBOX in the same transaction. */
  async payInvoice(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, number, client_id, total_minor, currency, status FROM finance_invoice WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status !== 'PAID') {
        await m.query(`UPDATE finance_invoice SET status='PAID', paid_at=now(), updated_at=now() WHERE id=$1`, [id]);
        await this.outbox.write(m, EVENT_TYPES.FINANCE_INVOICE_PAID, {
          invoiceId: inv.id,
          number: inv.number,
          clientId: inv.client_id,
          totalMinor: Number(inv.total_minor),
          currency: inv.currency,
        });
      }
      return { id: inv.id, number: inv.number, status: 'PAID' };
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
    ...(r.level !== undefined ? { level: Number(r.level) } : {}),
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
    clientId: r.client_id ?? null,
    lineItems: r.line_items,
    subtotal: money(r.subtotal_minor),
    tax: money(r.tax_minor),
    total: money(r.total_minor),
    status: r.status,
    dueDate: r.due_date ?? null,
  };
}

function isUnique(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}
function isForeignKey(err: unknown): boolean {
  return (err as { code?: string })?.code === '23503';
}
