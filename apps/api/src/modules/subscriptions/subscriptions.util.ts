import type { Money } from '@metaxperts/shared';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
type Row = Record<string, unknown>;

export type Interval = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/** Allocate the next per-tenant, per-type subscription document number (SUB-000001, SINV-000001). */
export async function nextSubNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO sub_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = sub_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(6, '0')}`;
}

const UNIT: Record<Interval, string> = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' };

/** A safe Postgres interval literal from a validated interval + count, e.g. `interval '3 month'`. */
export function intervalLiteral(interval: Interval, count: number): string {
  const n = Math.max(1, Math.floor(count) || 1);
  const unit = UNIT[interval] ?? 'month';
  return `interval '${n} ${unit}'`;
}

/** Normalise a per-cycle amount to a monthly figure (for MRR). All integer minor units. */
export function monthlyMinor(amountMinor: number, interval: Interval, intervalCount: number, quantity = 1): number {
  const count = Math.max(1, intervalCount);
  const perCycle = amountMinor * quantity;
  switch (interval) {
    case 'DAY': return Math.round((perCycle * 30) / count);
    case 'WEEK': return Math.round((perCycle * 52) / 12 / count);
    case 'YEAR': return Math.round(perCycle / (12 * count));
    case 'MONTH':
    default: return Math.round(perCycle / count);
  }
}

// ── Mappers ───────────────────────────────────────────────────────────────────
const money = (amountMinor: unknown, currency: unknown): Money => ({ amountMinor: Number(amountMinor ?? 0), currency: (currency as string) ?? 'PKR' });
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : ((v as string) ?? null));
const dateOnly = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : ((v as string) ?? null));

export function mapPlan(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    code: (r.code as string) ?? null,
    description: (r.description as string) ?? null,
    price: money(r.amount_minor, r.currency),
    taxRate: Number(r.tax_rate ?? 0),
    billingInterval: r.billing_interval as string,
    intervalCount: Number(r.interval_count ?? 1),
    trialDays: Number(r.trial_days ?? 0),
    setupFee: money(r.setup_fee_minor, r.currency),
    status: r.status as string,
    activeSubscriptions: r.active_subscriptions == null ? undefined : Number(r.active_subscriptions),
  };
}

export function mapSubscription(r: Row) {
  const currency = r.currency;
  return {
    id: r.id as string,
    subscriptionNo: r.subscription_no as string,
    planId: r.plan_id as string,
    planName: (r.plan_name as string) ?? null,
    clientId: (r.client_id as string) ?? null,
    customerName: r.customer_name as string,
    customerEmail: r.customer_email as string,
    quantity: Number(r.quantity ?? 1),
    collectionMode: r.collection_mode as string,
    status: r.status as string,
    amount: money(r.amount_minor, currency),
    taxRate: Number(r.tax_rate ?? 0),
    billingInterval: r.billing_interval as string,
    intervalCount: Number(r.interval_count ?? 1),
    startDate: dateOnly(r.start_date),
    currentPeriodStart: iso(r.current_period_start),
    currentPeriodEnd: iso(r.current_period_end),
    trialEnd: iso(r.trial_end),
    nextBillingAt: iso(r.next_billing_at),
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
    canceledAt: iso(r.canceled_at),
    failedAttempts: Number(r.failed_attempts ?? 0),
    mrr: money(monthlyMinor(Number(r.amount_minor ?? 0), r.billing_interval as Interval, Number(r.interval_count ?? 1)), currency),
    invoiceCount: r.invoice_count == null ? undefined : Number(r.invoice_count),
    createdAt: iso(r.created_at),
  };
}

// ── GL posting ──────────────────────────────────────────────────────────────────
export interface SubGlAccounts {
  clearingAccountId: string | null;
  revenueAccountId: string | null;
  taxAccountId: string | null;
}
export interface SubGlEntry {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
}
export interface SubGlVoucher {
  description: string;
  voucherType: 'JV';
  occurredOn: string;
  reference: string;
  entries: SubGlEntry[];
}

/**
 * Build the GL voucher for a paid subscription invoice: Dr clearing (total), Cr revenue (subscription
 * fee), Cr tax (if configured, else folded into revenue). Returns null when the minimum accounts aren't
 * set or total ≤ 0. Always balanced: Σ debit = total = Σ credit.
 */
export function subInvoiceVoucher(
  a: SubGlAccounts,
  inv: { invoiceNo: string; amountMinor: number; taxMinor: number; totalMinor: number; occurredOn: string },
): SubGlVoucher | null {
  if (!a.clearingAccountId || !a.revenueAccountId || inv.totalMinor <= 0) return null;
  const taxEff = a.taxAccountId ? inv.taxMinor : 0;
  const revenueMinor = inv.amountMinor + (inv.taxMinor - taxEff);
  const entries: SubGlEntry[] = [
    { accountId: a.clearingAccountId, debitMinor: inv.totalMinor },
    { accountId: a.revenueAccountId, creditMinor: revenueMinor },
  ];
  if (taxEff > 0 && a.taxAccountId) entries.push({ accountId: a.taxAccountId, creditMinor: taxEff });
  return { description: `Subscription invoice ${inv.invoiceNo}`, voucherType: 'JV', occurredOn: inv.occurredOn, reference: inv.invoiceNo, entries };
}

// ── Customer transactional emails ───────────────────────────────────────────────
const fmtMoney = (minor: number, currency: string): string => `${currency} ${(minor / 100).toFixed(2)}`;

export interface SubEmailInfo {
  customerName: string;
  subscriptionNo?: string;
  invoiceNo?: string;
  totalMinor?: number;
  currency?: string;
  attemptCount?: number;
  link?: string | null;
  storeName?: string;
  reason?: string;
}

/** Plain-text customer email for a billing event: payment receipt, dunning notice, or cancellation. */
export function subscriptionEmail(kind: 'receipt' | 'dunning' | 'canceled', info: SubEmailInfo): { subject: string; text: string } {
  const store = info.storeName ?? 'Billing';
  const amt = info.totalMinor != null ? fmtMoney(info.totalMinor, info.currency ?? 'PKR') : '';
  const link = info.link ? `\n\nManage your subscription: ${info.link}` : '';
  if (kind === 'receipt') {
    return {
      subject: `Payment received — invoice ${info.invoiceNo}`,
      text: `Hi ${info.customerName},\n\nWe've received your payment of ${amt} for invoice ${info.invoiceNo} (subscription ${info.subscriptionNo}). Thank you!${link}\n\n— ${store}`,
    };
  }
  if (kind === 'dunning') {
    return {
      subject: `Action needed — payment failed for invoice ${info.invoiceNo}`,
      text: `Hi ${info.customerName},\n\nWe couldn't collect ${amt} for invoice ${info.invoiceNo} (attempt ${info.attemptCount}). Please update your payment to keep your subscription ${info.subscriptionNo} active.${link}\n\n— ${store}`,
    };
  }
  return {
    subject: `Your subscription ${info.subscriptionNo} has been cancelled`,
    text: `Hi ${info.customerName},\n\nYour subscription ${info.subscriptionNo} has been cancelled${info.reason === 'DUNNING' ? ' after repeated failed payments' : ''}. We're sorry to see you go.${link}\n\n— ${store}`,
  };
}

export function mapInvoice(r: Row) {
  const currency = r.currency;
  return {
    id: r.id as string,
    invoiceNo: r.invoice_no as string,
    subscriptionId: r.subscription_id as string,
    subscriptionNo: (r.subscription_no as string) ?? null,
    clientId: (r.client_id as string) ?? null,
    periodStart: iso(r.period_start),
    periodEnd: iso(r.period_end),
    amount: money(r.amount_minor, currency),
    tax: money(r.tax_minor, currency),
    total: money(r.total_minor, currency),
    status: r.status as string,
    dueDate: iso(r.due_date),
    issuedAt: iso(r.issued_at),
    paidAt: iso(r.paid_at),
    attemptCount: Number(r.attempt_count ?? 0),
    paymentRef: (r.payment_ref as string) ?? null,
  };
}
