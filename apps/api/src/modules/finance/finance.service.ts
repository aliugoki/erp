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
  CreateAccountDto,
  CreateInvoiceDto,
  CreateTransactionDto,
  LedgerQueryDto,
  ListInvoicesQueryDto,
  ListTransactionsQueryDto,
  PeriodQueryDto,
} from './dto/finance.dto';
import {
  type AccountType,
  UnbalancedTransactionError,
  assertBalanced,
  computeInvoiceTotals,
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

  // ── Chart of accounts (hierarchical) ─────────────────────────────────────────
  async createAccount(dto: CreateAccountDto) {
    return this.tenantTx.run(async (m) => {
      if (dto.parentId) {
        const parent = (await m.query(
          `SELECT is_group FROM finance_account WHERE id=$1 AND deleted_at IS NULL`,
          [dto.parentId],
        )) as Array<{ is_group: boolean }>;
        if (!parent[0]) throw new BadRequestException('Parent account not found in this tenant');
        if (!parent[0].is_group) {
          throw new UnprocessableEntityException('Parent must be a group account');
        }
      }
      try {
        const rows = (await m.query(
          `INSERT INTO finance_account (tenant_id, code, name, type, parent_id, is_group)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5)
           RETURNING id, code, name, type, parent_id, is_group`,
          [dto.code, dto.name, dto.type, dto.parentId ?? null, dto.isGroup ?? false],
        )) as Row[];
        return mapAccount(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Account code "${dto.code}" already exists`);
        throw err;
      }
    });
  }

  /** The chart of accounts as a tree-ordered flat list (each row carries its depth `level`). */
  async listAccounts() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`
        WITH RECURSIVE tree AS (
          SELECT id, code, name, type, parent_id, is_group, 1 AS level, ARRAY[code] AS path
            FROM finance_account
           WHERE deleted_at IS NULL AND parent_id IS NULL
          UNION ALL
          SELECT c.id, c.code, c.name, c.type, c.parent_id, c.is_group, t.level + 1, t.path || c.code
            FROM finance_account c
            JOIN tree t ON c.parent_id = t.id
           WHERE c.deleted_at IS NULL
        )
        SELECT id, code, name, type, parent_id, is_group, level FROM tree ORDER BY path
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
        `SELECT id, is_group FROM finance_account WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [ids],
      )) as Array<{ id: string; is_group: boolean }>;
      if (accts.length !== ids.length) {
        throw new BadRequestException('One or more accounts do not exist in this tenant');
      }
      if (accts.some((a) => a.is_group)) {
        throw new UnprocessableEntityException('Cannot post to a group account — choose a leaf account');
      }

      const txRows = (await m.query(
        `INSERT INTO finance_transaction (tenant_id, description, occurred_on, reference)
         VALUES (current_setting('app.tenant_id')::uuid, $1, COALESCE($2::date, current_date), $3)
         RETURNING id, description, occurred_on, reference`,
        [dto.description, dto.occurredOn ?? null, dto.reference ?? null],
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
        `SELECT id, description, occurred_on, reference FROM finance_transaction WHERE id=$1 AND deleted_at IS NULL`,
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

  /** Paginated list of journal transactions (header + its total debit), newest first. */
  async listTransactions(query: ListTransactionsQueryDto): Promise<SuccessEnvelope<unknown[]>> {
    const { page, pageSize, limit, offset } = normalizePagination(query.page, query.pageSize);
    const conditions = ['t.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (query.from) conditions.push(`t.occurred_on >= $${params.push(query.from)}`);
    if (query.to) conditions.push(`t.occurred_on <= $${params.push(query.to)}`);
    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT t.id, t.description, t.occurred_on, t.reference,
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
          occurredOn: r.occurred_on,
          reference: r.reference ?? null,
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
    ...(r.level !== undefined ? { level: Number(r.level) } : {}),
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
