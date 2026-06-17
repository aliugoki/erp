import type { Money } from '@metaxperts/shared';

/** Minimal structural manager type so helpers stay DB-driver-agnostic. */
type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Allocate the next per-tenant, per-type POS document number (SALE-000001, SHIFT-000001). */
export async function nextPosDocNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO pos_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = pos_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(6, '0')}`;
}

export interface PosLineInput {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor?: number;
  taxRate?: number;
}

export interface ComputedLine {
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

/**
 * Price one line: gross = qty × unit price; discount is clamped to [0, gross]; tax = floor(taxable ×
 * rate%) on the post-discount amount; line total = taxable + tax. All integer minor units.
 */
export function computeLine(line: PosLineInput): ComputedLine {
  const grossMinor = line.quantity * line.unitPriceMinor;
  const discountMinor = Math.min(Math.max(line.discountMinor ?? 0, 0), grossMinor);
  const taxableMinor = grossMinor - discountMinor;
  const taxMinor = Math.floor((taxableMinor * (line.taxRate ?? 0)) / 100);
  return { grossMinor, discountMinor, taxMinor, lineTotalMinor: taxableMinor + taxMinor };
}

export interface SaleTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Aggregate lines into sale totals. `subtotal` is the gross of all lines; `discount` folds in every
 * line discount plus any order-level discount; `tax` is the sum of per-line tax; `total` =
 * subtotal − discount + tax. Order discount is clamped so the total never goes below the tax floor.
 */
export function computeSaleTotals(lines: PosLineInput[], orderDiscountMinor = 0): SaleTotals {
  const computed = lines.map(computeLine);
  const subtotalMinor = computed.reduce((s, l) => s + l.grossMinor, 0);
  const lineDiscountMinor = computed.reduce((s, l) => s + l.discountMinor, 0);
  const taxMinor = computed.reduce((s, l) => s + l.taxMinor, 0);
  const maxOrderDiscount = Math.max(subtotalMinor - lineDiscountMinor, 0);
  const orderDisc = Math.min(Math.max(orderDiscountMinor, 0), maxOrderDiscount);
  const discountMinor = lineDiscountMinor + orderDisc;
  return { subtotalMinor, discountMinor, taxMinor, totalMinor: subtotalMinor - discountMinor + taxMinor };
}

/** Change owed to the customer = max(0, tendered − total). */
export function changeMinor(paidMinor: number, totalMinor: number): number {
  return Math.max(0, paidMinor - totalMinor);
}

/** Expected cash in the drawer at close = opening float + cash taken − cash refunded. */
export function expectedCashMinor(openingFloatMinor: number, cashInMinor: number, cashOutMinor: number): number {
  return openingFloatMinor + cashInMinor - cashOutMinor;
}

/** Cash variance at close = counted − expected (negative = short, positive = over). */
export function varianceMinor(countedMinor: number, expectedMinor: number): number {
  return countedMinor - expectedMinor;
}

// ── Card terminal ───────────────────────────────────────────────────────────
export interface TerminalChargeResult {
  status: 'APPROVED' | 'DECLINED' | 'ERROR';
  reference: string | null;
  scheme: string | null;
  last4: string | null;
  message: string | null;
}

const hashInt = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0);
  return h >>> 0;
};

/**
 * Built-in `SIMULATED` card terminal — deterministic from (reference, amount) so it's testable and
 * never relies on randomness. Always approves with a plausible scheme + last-4 + auth code, standing
 * in for a real reader during demos/dev. (`DECLINED`/`ERROR` come only from a real `BRIDGE` device.)
 */
export function simulateTerminalCharge(reference: string, amountMinor: number): TerminalChargeResult {
  const h = hashInt(`${reference}:${amountMinor}`);
  const scheme = ['VISA', 'MASTERCARD', 'AMEX', 'UNIONPAY'][h % 4]!;
  return {
    status: 'APPROVED',
    reference: `SIM${String(h % 1_000_000).padStart(6, '0')}`,
    scheme,
    last4: String(h % 10_000).padStart(4, '0'),
    message: 'Approved (simulated terminal)',
  };
}

// ── GL posting ──────────────────────────────────────────────────────────────
export interface PosGlAccounts {
  clearingAccountId: string | null;
  revenueAccountId: string | null;
  taxAccountId: string | null;
  cogsAccountId: string | null;
  inventoryAccountId: string | null;
}
export interface GlEntry {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
}
export interface GlVoucher {
  description: string;
  voucherType: 'JV';
  occurredOn: string;
  reference: string;
  entries: GlEntry[];
}

/**
 * Build the GL voucher for a completed POS sale: Dr clearing (total), Cr revenue (total − tax) [+ Cr
 * tax], and Dr COGS / Cr inventory for the cost side. A RETURN reverses every line. Returns null when
 * the minimum accounts (clearing + revenue) aren't set or the total is zero, so the caller skips
 * posting. Always balanced: Σ debit = total (+ cogs) = Σ credit.
 */
export function posSaleVoucher(
  a: PosGlAccounts,
  sale: { saleNo: string; type: 'SALE' | 'RETURN'; totalMinor: number; taxMinor: number; cogsMinor: number; occurredOn: string },
): GlVoucher | null {
  if (!a.clearingAccountId || !a.revenueAccountId || sale.totalMinor <= 0) return null;
  const ret = sale.type === 'RETURN';
  const drSide = (accountId: string, amount: number): GlEntry => (ret ? { accountId, creditMinor: amount } : { accountId, debitMinor: amount });
  const crSide = (accountId: string, amount: number): GlEntry => (ret ? { accountId, debitMinor: amount } : { accountId, creditMinor: amount });
  const taxEff = a.taxAccountId ? sale.taxMinor : 0;
  const entries: GlEntry[] = [drSide(a.clearingAccountId, sale.totalMinor), crSide(a.revenueAccountId, sale.totalMinor - taxEff)];
  if (taxEff > 0 && a.taxAccountId) entries.push(crSide(a.taxAccountId, taxEff));
  if (sale.cogsMinor > 0 && a.cogsAccountId && a.inventoryAccountId) {
    entries.push(drSide(a.cogsAccountId, sale.cogsMinor), crSide(a.inventoryAccountId, sale.cogsMinor));
  }
  return { description: `POS ${sale.saleNo}`, voucherType: 'JV', occurredOn: sale.occurredOn, reference: sale.saleNo, entries };
}

// ── Mappers ───────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const money = (amountMinor: unknown, currency: unknown): Money => ({
  amountMinor: Number(amountMinor ?? 0),
  currency: (currency as string) ?? 'PKR',
});
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : ((v as string) ?? null);

export function mapRegister(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    code: (r.code as string) ?? null,
    warehouseId: (r.warehouse_id as string) ?? null,
    location: (r.location as string) ?? null,
    status: r.status as string,
    currency: r.currency as string,
    cardTerminalProvider: (r.card_terminal_provider as string) ?? 'NONE',
    cardTerminalUrl: (r.card_terminal_url as string) ?? null,
  };
}

export function mapShift(r: Row) {
  const currency = r.currency;
  return {
    id: r.id as string,
    shiftNo: r.shift_no as string,
    registerId: r.register_id as string,
    cashierId: (r.cashier_id as string) ?? null,
    status: r.status as string,
    openedAt: iso(r.opened_at),
    closedAt: iso(r.closed_at),
    openingFloat: money(r.opening_float_minor, currency),
    countedCash: r.counted_cash_minor == null ? null : money(r.counted_cash_minor, currency),
    expectedCash: r.expected_cash_minor == null ? null : money(r.expected_cash_minor, currency),
    variance: r.variance_minor == null ? null : money(r.variance_minor, currency),
    notes: (r.notes as string) ?? null,
  };
}

export function mapPayment(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    method: r.method as string,
    amount: money(r.amount_minor, currency),
    reference: (r.reference as string) ?? null,
    cardScheme: (r.card_scheme as string) ?? null,
    cardLast4: (r.card_last4 as string) ?? null,
    paidAt: iso(r.paid_at),
  };
}

export function mapSaleLine(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    productId: (r.product_id as string) ?? null,
    description: r.description as string,
    quantity: Number(r.quantity ?? 0),
    unitPrice: money(r.unit_price_minor, currency),
    discount: money(r.discount_minor, currency),
    taxRate: Number(r.tax_rate ?? 0),
    tax: money(r.tax_minor, currency),
    lineTotal: money(r.line_total_minor, currency),
    returnedQty: Number(r.returned_qty ?? 0),
  };
}

export function mapSale(r: Row) {
  const currency = r.currency;
  return {
    id: r.id as string,
    saleNo: r.sale_no as string,
    registerId: r.register_id as string,
    shiftId: r.shift_id as string,
    clientId: (r.client_id as string) ?? null,
    customerName: (r.customer_name as string) ?? null,
    type: r.type as string,
    originalSaleId: (r.original_sale_id as string) ?? null,
    status: r.status as string,
    subtotal: money(r.subtotal_minor, currency),
    discount: money(r.discount_minor, currency),
    tax: money(r.tax_minor, currency),
    total: money(r.total_minor, currency),
    paid: money(r.paid_minor, currency),
    change: money(r.change_minor, currency),
    cogs: money(r.cogs_minor, currency),
    refunded: money(r.refunded_minor, currency),
    soldAt: iso(r.sold_at),
    notes: (r.notes as string) ?? null,
  };
}
