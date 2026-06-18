import type { Money } from '@metaxperts/shared';

/** Minimal structural manager type so helpers stay DB-driver-agnostic. */
type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
type Row = Record<string, unknown>;

/** Allocate the next per-tenant, per-type ecommerce document number (ORD-000001). */
export async function nextEcDocNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO ec_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = ec_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(6, '0')}`;
}

/** A URL-safe slug from a free-text title (lowercase, hyphenated, trimmed to 60 chars). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── Pricing (integer minor units) ───────────────────────────────────────────────
export interface PricedLine {
  ecProductId: string;
  productId: string | null;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  taxRate: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface DiscountInput {
  type: 'PERCENT' | 'FIXED';
  value: number;
}

export interface OrderTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
}

/** Price one cart line: gross = qty × unit; tax = floor(gross × rate%); lineTotal = gross + tax. */
export function priceLine(input: {
  ecProductId: string;
  productId: string | null;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  taxRate: number;
}): PricedLine {
  const gross = input.quantity * input.unitPriceMinor;
  const taxMinor = Math.floor((gross * (input.taxRate || 0)) / 100);
  return { ...input, taxMinor, lineTotalMinor: gross + taxMinor };
}

/** The order-level discount in minor units (clamped to the subtotal). Tax/shipping are excluded. */
export function discountMinorFor(discount: DiscountInput | null, subtotalMinor: number): number {
  if (!discount) return 0;
  const raw = discount.type === 'PERCENT'
    ? Math.floor((subtotalMinor * discount.value) / 100)
    : discount.value;
  return Math.min(Math.max(raw, 0), subtotalMinor);
}

/**
 * Aggregate priced lines + an optional coupon + shipping into order totals. Discount applies to the
 * pre-tax merchandise subtotal; tax is the sum of per-line tax; total = subtotal − discount + tax +
 * shipping. All integer minor units.
 */
export function computeOrderTotals(
  lines: PricedLine[],
  discount: DiscountInput | null,
  shippingMinor: number,
): OrderTotals {
  const subtotalMinor = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
  const taxMinor = lines.reduce((s, l) => s + l.taxMinor, 0);
  const discountMinor = discountMinorFor(discount, subtotalMinor);
  const ship = Math.max(shippingMinor, 0);
  return { subtotalMinor, discountMinor, taxMinor, shippingMinor: ship, totalMinor: subtotalMinor - discountMinor + taxMinor + ship };
}

/** Shipping charge for a subtotal: free over the threshold, otherwise the flat rate. */
export function shippingFor(subtotalMinor: number, flatMinor: number, freeOverMinor: number | null): number {
  if (freeOverMinor != null && subtotalMinor >= freeOverMinor) return 0;
  return Math.max(flatMinor, 0);
}

// ── GL posting ──────────────────────────────────────────────────────────────────
export interface EcGlAccounts {
  clearingAccountId: string | null;
  revenueAccountId: string | null;
  taxAccountId: string | null;
  cogsAccountId: string | null;
  inventoryAccountId: string | null;
  shippingAccountId: string | null;
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
 * Build the GL voucher for a placed online order: Dr clearing (total), Cr revenue (merchandise net of
 * discount), Cr tax (if configured else folded into revenue), Cr shipping income (if configured else
 * folded into revenue), and Dr COGS / Cr inventory for the cost side. Returns null when the minimum
 * accounts (clearing + revenue) aren't set or total ≤ 0. Always balanced: Σ debit = total (+ cogs) = Σ credit.
 */
export function ecOrderVoucher(
  a: EcGlAccounts,
  order: {
    orderNo: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    shippingMinor: number;
    totalMinor: number;
    cogsMinor: number;
    occurredOn: string;
  },
): GlVoucher | null {
  if (!a.clearingAccountId || !a.revenueAccountId || order.totalMinor <= 0) return null;
  const taxEff = a.taxAccountId ? order.taxMinor : 0;
  const shipEff = a.shippingAccountId ? order.shippingMinor : 0;
  const merchandiseMinor = order.subtotalMinor - order.discountMinor; // net revenue
  const revenueMinor = merchandiseMinor + (order.taxMinor - taxEff) + (order.shippingMinor - shipEff);
  const entries: GlEntry[] = [
    { accountId: a.clearingAccountId, debitMinor: order.totalMinor },
    { accountId: a.revenueAccountId, creditMinor: revenueMinor },
  ];
  if (taxEff > 0 && a.taxAccountId) entries.push({ accountId: a.taxAccountId, creditMinor: taxEff });
  if (shipEff > 0 && a.shippingAccountId) entries.push({ accountId: a.shippingAccountId, creditMinor: shipEff });
  if (order.cogsMinor > 0 && a.cogsAccountId && a.inventoryAccountId) {
    entries.push(
      { accountId: a.cogsAccountId, debitMinor: order.cogsMinor },
      { accountId: a.inventoryAccountId, creditMinor: order.cogsMinor },
    );
  }
  return { description: `Online order ${order.orderNo}`, voucherType: 'JV', occurredOn: order.occurredOn, reference: order.orderNo, entries };
}

// ── Customer transactional emails ───────────────────────────────────────────────
export interface OrderEmailInfo {
  orderNo: string;
  customerName: string;
  customerEmail: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  totalMinor: number;
  currency: string;
  lineCount: number;
  storeName: string;
}

/** Format integer minor units for an email body. */
function emailMoney(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Build the customer-facing email for an order event. `kind` is 'placed' (confirmation) or a fulfilment
 * status. Returns null for statuses that don't warrant a customer email (e.g. PENDING), so the consumer
 * skips silently. Plain text — the mailer sends `{ to, subject, text }`.
 */
export function customerOrderEmail(info: OrderEmailInfo, kind: 'placed' | string): { subject: string; text: string } | null {
  const total = emailMoney(info.totalMinor, info.currency);
  const hi = `Hi ${info.customerName.split(' ')[0] || 'there'},`;
  const sign = `\n\nThank you,\n${info.storeName}`;

  if (kind === 'placed') {
    const pay = info.paymentStatus === 'PAID' ? 'Your payment has been received.' : 'You’ll pay on delivery.';
    return {
      subject: `${info.storeName} — order ${info.orderNo} confirmed`,
      text: `${hi}\n\nThanks for your order! We’ve received order ${info.orderNo} (${info.lineCount} item(s)) totalling ${total}. ${pay}\n\nWe’ll email you as it progresses.${sign}`,
    };
  }

  switch (kind) {
    case 'PAID':
      return { subject: `${info.storeName} — payment received for ${info.orderNo}`, text: `${hi}\n\nWe’ve received your payment of ${total} for order ${info.orderNo}. It’s now being prepared.${sign}` };
    case 'FULFILLED':
      return { subject: `${info.storeName} — order ${info.orderNo} is being prepared`, text: `${hi}\n\nGood news — order ${info.orderNo} is packed and being prepared for shipment.${sign}` };
    case 'SHIPPED':
      return { subject: `${info.storeName} — order ${info.orderNo} has shipped 🚚`, text: `${hi}\n\nYour order ${info.orderNo} is on its way! You’ll receive it soon.${sign}` };
    case 'CANCELLED':
      return { subject: `${info.storeName} — order ${info.orderNo} cancelled`, text: `${hi}\n\nYour order ${info.orderNo} has been cancelled. If this is unexpected, please reply to this email.${sign}` };
    case 'REFUNDED':
      return { subject: `${info.storeName} — order ${info.orderNo} refunded`, text: `${hi}\n\nA refund of ${total} for order ${info.orderNo} has been processed. It may take a few days to appear.${sign}` };
    default:
      return null; // PENDING or any other status → no customer email
  }
}

// ── Mappers ───────────────────────────────────────────────────────────────────
const money = (amountMinor: unknown, currency: unknown): Money => ({
  amountMinor: Number(amountMinor ?? 0),
  currency: (currency as string) ?? 'PKR',
});
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : ((v as string) ?? null));

export function mapStore(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    tagline: (r.tagline as string) ?? null,
    description: (r.description as string) ?? null,
    currency: r.currency as string,
    accentColor: r.accent_color as string,
    hasLogo: !!r.logo_attachment_id,
    hasHero: !!r.hero_attachment_id,
    heroHeadline: (r.hero_headline as string) ?? null,
    heroSubtext: (r.hero_subtext as string) ?? null,
    supportEmail: (r.support_email as string) ?? null,
    supportPhone: (r.support_phone as string) ?? null,
    address: (r.address as string) ?? null,
    defaultTaxRate: Number(r.default_tax_rate ?? 0),
    shippingFlat: money(r.shipping_flat_minor, r.currency),
    freeShippingOver: r.free_shipping_over_minor == null ? null : money(r.free_shipping_over_minor, r.currency),
    published: !!r.published,
  };
}

export function mapCollection(r: Row) {
  return {
    id: r.id as string,
    title: r.title as string,
    slug: r.slug as string,
    description: (r.description as string) ?? null,
    sort: Number(r.sort ?? 0),
    isFeatured: !!r.is_featured,
    productCount: r.product_count == null ? undefined : Number(r.product_count),
  };
}

export function mapProduct(r: Row, currency: unknown) {
  const priceMinor = r.price_minor == null ? Number(r.sell_price_minor ?? 0) : Number(r.price_minor);
  return {
    id: r.id as string,
    productId: (r.product_id as string) ?? null,
    slug: r.slug as string,
    title: r.title as string,
    subtitle: (r.subtitle as string) ?? null,
    description: (r.description as string) ?? null,
    seoTitle: (r.seo_title as string) ?? null,
    seoDescription: (r.seo_description as string) ?? null,
    status: r.status as string,
    isFeatured: !!r.is_featured,
    sort: Number(r.sort ?? 0),
    taxRate: Number(r.tax_rate ?? 0),
    price: money(priceMinor, currency),
    compareAt: r.compare_at_minor == null ? null : money(r.compare_at_minor, currency),
    sku: (r.sku as string) ?? null,
    onHand: r.on_hand == null ? null : Number(r.on_hand),
    primaryImageId: (r.primary_image_id as string) ?? null,
    imageCount: r.image_count == null ? undefined : Number(r.image_count),
  };
}

export function mapVariant(r: Row, currency: unknown) {
  const priceMinor = r.price_minor == null ? Number(r.sell_price_minor ?? 0) : Number(r.price_minor);
  return {
    id: r.id as string,
    productId: r.product_id as string,
    inventoryProductId: r.inventory_product_id as string,
    label: r.label as string,
    status: r.status as string,
    sort: Number(r.sort ?? 0),
    isDefault: !!r.is_default,
    price: money(priceMinor, currency),
    compareAt: r.compare_at_minor == null ? null : money(r.compare_at_minor, currency),
    sku: (r.sku as string) ?? null,
    onHand: r.on_hand == null ? null : Number(r.on_hand),
  };
}

export function mapOrderLine(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    ecProductId: (r.ec_product_id as string) ?? null,
    productId: (r.product_id as string) ?? null,
    variantId: (r.variant_id as string) ?? null,
    variantLabel: (r.variant_label as string) ?? null,
    title: r.title as string,
    quantity: Number(r.quantity ?? 0),
    unitPrice: money(r.unit_price_minor, currency),
    taxRate: Number(r.tax_rate ?? 0),
    tax: money(r.tax_minor, currency),
    lineTotal: money(r.line_total_minor, currency),
  };
}

export function mapOrder(r: Row) {
  const currency = r.currency;
  return {
    id: r.id as string,
    orderNo: r.order_no as string,
    clientId: (r.client_id as string) ?? null,
    customerName: r.customer_name as string,
    customerEmail: r.customer_email as string,
    customerPhone: (r.customer_phone as string) ?? null,
    shippingAddress: (r.shipping_address as string) ?? null,
    shippingCity: (r.shipping_city as string) ?? null,
    shippingCountry: (r.shipping_country as string) ?? null,
    status: r.status as string,
    paymentMethod: r.payment_method as string,
    paymentStatus: r.payment_status as string,
    paymentReference: (r.payment_reference as string) ?? null,
    subtotal: money(r.subtotal_minor, currency),
    discount: money(r.discount_minor, currency),
    tax: money(r.tax_minor, currency),
    shipping: money(r.shipping_minor, currency),
    total: money(r.total_minor, currency),
    cogs: money(r.cogs_minor, currency),
    discountCode: (r.discount_code as string) ?? null,
    placedAt: iso(r.placed_at),
    createdAt: iso(r.created_at),
  };
}

export function mapReview(r: Row) {
  return {
    id: r.id as string,
    productId: r.product_id as string,
    productTitle: (r.product_title as string) ?? null,
    authorName: r.author_name as string,
    rating: Number(r.rating ?? 0),
    title: (r.title as string) ?? null,
    body: (r.body as string) ?? null,
    status: r.status as string,
    verified: !!r.verified,
    createdAt: iso(r.created_at),
  };
}

export function mapShippingZone(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    countries: (r.countries as string[]) ?? [],
    rate: money(r.rate_minor, r.currency),
    freeOver: r.free_over_minor == null ? null : money(r.free_over_minor, r.currency),
    sort: Number(r.sort ?? 0),
    enabled: !!r.enabled,
  };
}

export function mapDiscount(r: Row) {
  return {
    id: r.id as string,
    code: r.code as string,
    type: r.type as string,
    value: Number(r.value ?? 0),
    active: !!r.active,
    minSubtotalMinor: Number(r.min_subtotal_minor ?? 0),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    usageLimit: r.usage_limit == null ? null : Number(r.usage_limit),
    usedCount: Number(r.used_count ?? 0),
  };
}
