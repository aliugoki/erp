import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type SuccessEnvelope, paginationMeta } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import { normalizePagination } from '../hr/hr.util';
import type {
  CreateAccountDto,
  CreateInvoiceDto,
  CreateTransactionDto,
  ListInvoicesQueryDto,
} from './dto/finance.dto';
import { UnbalancedTransactionError, assertBalanced, computeInvoiceTotals } from './finance.util';

type Row = Record<string, unknown>;

@Injectable()
export class FinanceService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Chart of accounts ──────────────────────────────────────────────────────
  async createAccount(dto: CreateAccountDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO finance_account (tenant_id, code, name, type)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)
           RETURNING id, code, name, type`,
          [dto.code, dto.name, dto.type],
        )) as Row[];
        return rows[0];
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Account code "${dto.code}" already exists`);
        throw err;
      }
    });
  }

  async listAccounts() {
    return this.tenantTx.run((m) =>
      m.query(`SELECT id, code, name, type FROM finance_account WHERE deleted_at IS NULL ORDER BY code`),
    );
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
        await this.outbox.write(m, 'finance.invoice_paid', {
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
