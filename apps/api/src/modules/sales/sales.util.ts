import type { Money } from '@metaxperts/shared';

/** Minimal structural manager type so helpers stay DB-driver-agnostic. */
type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Allocate the next per-tenant, per-type sales document number (QUO-0001, SO-0001). */
export async function nextSalesDocNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO sales_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = sales_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(4, '0')}`;
}

export interface LineInput {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number;
}

/** A line's total = quantity × unit price (integer minor units). */
export function lineTotalMinor(quantity: number, unitPriceMinor: number): number {
  return quantity * unitPriceMinor;
}

export interface DocTotals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** Subtotal = Σ line totals; tax = floor(subtotal × rate%); total = subtotal + tax. All integer. */
export function computeTotals(lines: LineInput[], taxRatePercent: number): DocTotals {
  const subtotalMinor = lines.reduce((sum, l) => sum + lineTotalMinor(l.quantity, l.unitPriceMinor), 0);
  const taxMinor = Math.floor((subtotalMinor * taxRatePercent) / 100);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

const money = (amountMinor: unknown, currency: unknown): Money => ({
  amountMinor: Number(amountMinor ?? 0),
  currency: (currency as string) ?? 'PKR',
});

type Row = Record<string, unknown>;

export function mapQuotation(r: Row) {
  return {
    id: r.id as string,
    quoteNo: r.quote_no as string,
    clientId: r.client_id as string,
    dealId: (r.deal_id as string) ?? null,
    status: r.status as string,
    validUntil: r.valid_until instanceof Date ? r.valid_until.toISOString().slice(0, 10) : ((r.valid_until as string) ?? null),
    taxRate: Number(r.tax_rate ?? 0),
    subtotal: money(r.subtotal_minor, r.currency),
    tax: money(r.tax_minor, r.currency),
    total: money(r.total_minor, r.currency),
    notes: (r.notes as string) ?? null,
  };
}

export function mapOrder(r: Row) {
  return {
    id: r.id as string,
    soNo: r.so_no as string,
    clientId: r.client_id as string,
    quotationId: (r.quotation_id as string) ?? null,
    status: r.status as string,
    orderDate: r.order_date instanceof Date ? r.order_date.toISOString().slice(0, 10) : ((r.order_date as string) ?? null),
    expectedDate: r.expected_date instanceof Date ? r.expected_date.toISOString().slice(0, 10) : ((r.expected_date as string) ?? null),
    total: money(r.total_minor, r.currency),
    notes: (r.notes as string) ?? null,
  };
}

export function mapLine(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    productId: (r.product_id as string) ?? null,
    description: r.description as string,
    quantity: Number(r.quantity ?? 0),
    deliveredQty: r.delivered_qty === undefined ? undefined : Number(r.delivered_qty ?? 0),
    unitPrice: money(r.unit_price_minor, currency),
    lineTotal: money(r.line_total_minor, currency),
  };
}
