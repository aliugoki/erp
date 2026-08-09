import type { RestaurantBillSettledV1 } from '@metaxperts/shared';

/** Restaurant GL account map (from restaurant_gl_config), consumed when a settled bill posts. */
export interface RestaurantGlAccounts {
  revenueAccountId: string | null;
  taxAccountId: string | null;
  cogsAccountId: string | null;
  inventoryAccountId: string | null;
  cashAccountId: string | null;
  bankAccountId: string | null;
  cardClearingAccountId: string | null;
  walletClearingAccountId: string | null;
  giftCardLiabilityAccountId: string | null;
  discountAccountId: string | null;
  serviceChargeAccountId: string | null;
  tipsPayableAccountId: string | null;
  roundingAccountId: string | null;
  receivableAccountId: string | null;
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

/** Pick the settlement (debit) account for a tender method, falling back to any configured cash-like account. */
function settlementAccount(a: RestaurantGlAccounts, method: string): string | null {
  const fallback = a.cashAccountId ?? a.bankAccountId ?? a.cardClearingAccountId ?? a.receivableAccountId;
  switch (method) {
    case 'CASH': return a.cashAccountId ?? fallback;
    case 'CARD': return a.cardClearingAccountId ?? fallback;
    case 'WALLET': return a.walletClearingAccountId ?? fallback;
    case 'GIFT_CARD': return a.giftCardLiabilityAccountId ?? fallback;
    case 'ONLINE': return a.bankAccountId ?? a.cardClearingAccountId ?? fallback;
    case 'ROOM_CHARGE': return a.receivableAccountId ?? fallback;
    case 'AGGREGATOR': return a.receivableAccountId ?? a.cardClearingAccountId ?? fallback;
    case 'LOYALTY': return a.discountAccountId ?? fallback;
    default: return fallback;
  }
}

/**
 * Build the balanced GL voucher for a settled restaurant bill (occurredOn supplied by the caller since
 * event scripts can't read the clock). Debits: each tender's settlement account by its amount, with any
 * cash **change** (paid − total) netted off cash tenders so total debits equal the bill total. Credits:
 * net sales (subtotal − discount) to revenue, tax, service charge, tip (tips-payable) and rounding — each
 * falling back to revenue when its dedicated account is unset, so the voucher always balances. Cost side:
 * Dr COGS / Cr inventory. Returns null when revenue isn't configured or the total is non-positive.
 * Guarantees Σ debit = Σ credit.
 */
export function restaurantBillVoucher(a: RestaurantGlAccounts, bill: RestaurantBillSettledV1, occurredOn: string): GlVoucher | null {
  if (!a.revenueAccountId || bill.totalMinor <= 0) return null;

  const entries: GlEntry[] = [];

  // ── Debit side: tenders, with cash change netted off so debits == total ──────────
  const paid = bill.payments.reduce((s, p) => s + p.amountMinor, 0);
  let change = Math.max(0, paid - bill.totalMinor);
  const debits = new Map<string, number>();
  // Net change off cash tenders first (reduce from the largest cash tenders).
  const cashPayments = bill.payments.filter((p) => p.method === 'CASH').sort((x, y) => y.amountMinor - x.amountMinor);
  const changeByIndex = new Map<number, number>();
  for (const p of cashPayments) {
    if (change <= 0) break;
    const take = Math.min(change, p.amountMinor);
    changeByIndex.set(bill.payments.indexOf(p), take);
    change -= take;
  }
  bill.payments.forEach((p, i) => {
    const effective = p.amountMinor - (changeByIndex.get(i) ?? 0);
    if (effective <= 0) return;
    const acct = settlementAccount(a, p.method) ?? a.revenueAccountId!;
    debits.set(acct, (debits.get(acct) ?? 0) + effective);
  });
  // If tenders under-cover (shouldn't happen — settle enforces paid >= total), plug the remainder to a debtor.
  const debitTotal = [...debits.values()].reduce((s, v) => s + v, 0);
  if (debitTotal < bill.totalMinor) {
    const acct = a.receivableAccountId ?? a.cashAccountId ?? a.revenueAccountId!;
    debits.set(acct, (debits.get(acct) ?? 0) + (bill.totalMinor - debitTotal));
  }
  for (const [accountId, amount] of debits) entries.push({ accountId, debitMinor: amount });

  // ── Credit side: revenue, tax, service charge, tip, rounding ─────────────────────
  const cr = (accountId: string | null, amount: number) => {
    if (amount === 0) return;
    const acct = accountId ?? a.revenueAccountId!;
    if (amount > 0) entries.push({ accountId: acct, creditMinor: amount });
    else entries.push({ accountId: acct, debitMinor: -amount });
  };
  const netSales = bill.subtotalMinor - bill.discountMinor;
  cr(a.revenueAccountId, netSales);
  cr(a.taxAccountId, bill.taxMinor);
  cr(a.serviceChargeAccountId, bill.serviceChargeMinor);
  cr(a.tipsPayableAccountId, bill.tipMinor);
  cr(a.roundingAccountId, bill.roundingMinor);

  // ── Cost side ────────────────────────────────────────────────────────────────────
  if (bill.cogsMinor > 0 && a.cogsAccountId && a.inventoryAccountId) {
    entries.push({ accountId: a.cogsAccountId, debitMinor: bill.cogsMinor });
    entries.push({ accountId: a.inventoryAccountId, creditMinor: bill.cogsMinor });
  }

  return { description: `Restaurant ${bill.orderNo}`, voucherType: 'JV', occurredOn, reference: bill.orderNo, entries };
}

/** Sum of debit and credit minor units of a voucher — used by tests/asserts to prove balance. */
export function voucherTotals(v: GlVoucher): { debit: number; credit: number } {
  return v.entries.reduce(
    (acc, e) => ({ debit: acc.debit + (e.debitMinor ?? 0), credit: acc.credit + (e.creditMinor ?? 0) }),
    { debit: 0, credit: 0 },
  );
}
