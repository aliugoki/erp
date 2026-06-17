/** Shared cashier-terminal logic: cart line shape + money math that mirrors the API's pos.util so the
 * on-screen totals match what the backend will compute and persist. Integer minor units throughout. */

export interface CartLine {
  key: string;
  productId: string | null;
  sku?: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxRate: number;
}

export interface Tender {
  method: string;
  amountMinor: number;
  reference?: string | null;
  cardScheme?: string | null;
  cardLast4?: string | null;
}

export interface LineTotals {
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** One line: gross = qty × price; discount clamped to [0, gross]; tax = floor(taxable × rate%). */
export function lineTotals(l: CartLine): LineTotals {
  const grossMinor = l.quantity * l.unitPriceMinor;
  const discountMinor = Math.min(Math.max(l.discountMinor || 0, 0), grossMinor);
  const taxableMinor = grossMinor - discountMinor;
  const taxMinor = Math.floor((taxableMinor * (l.taxRate || 0)) / 100);
  return { grossMinor, discountMinor, taxMinor, totalMinor: taxableMinor + taxMinor };
}

export interface CartTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  itemCount: number;
}

/** Aggregate the cart: subtotal (gross), discount (line + order), tax (sum per line), total. */
export function cartTotals(lines: CartLine[], orderDiscountMinor = 0): CartTotals {
  const t = lines.map(lineTotals);
  const subtotalMinor = t.reduce((s, x) => s + x.grossMinor, 0);
  const lineDiscount = t.reduce((s, x) => s + x.discountMinor, 0);
  const taxMinor = t.reduce((s, x) => s + x.taxMinor, 0);
  const maxOrder = Math.max(subtotalMinor - lineDiscount, 0);
  const orderDisc = Math.min(Math.max(orderDiscountMinor || 0, 0), maxOrder);
  const discountMinor = lineDiscount + orderDisc;
  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor: subtotalMinor - discountMinor + taxMinor,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  };
}

export const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE', 'WALLET', 'BANK', 'CREDIT', 'VOUCHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Parse a major-unit text field ("12.50") into integer minor units. */
export const toMinor = (major: string | number): number => Math.round((Number(major) || 0) * 100);

/** A short stable key for new cart lines without needing crypto/Date at render time. */
let seq = 0;
export const nextKey = (): string => `l${(seq = (seq + 1) % 1_000_000)}`;
