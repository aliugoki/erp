/** Pharmacy GL account map (consumed when posting a dispense to the ledger). */
export interface PharmacyGlAccounts {
  clearingAccountId: string | null;
  receivableAccountId: string | null;
  revenueAccountId: string | null;
  taxAccountId: string | null;
  discountAccountId: string | null;
  cogsAccountId: string | null;
  inventoryAccountId: string | null;
  writeoffAccountId: string | null;
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

export interface DispenseForGl {
  dispenseNo: string;
  type: 'RETAIL_SALE' | 'RX' | 'HOSPITAL_ISSUE' | 'WHOLESALE';
  status: 'COMPLETED' | 'RETURNED' | 'VOID';
  totalMinor: number;
  taxMinor: number;
  cogsMinor: number;
  paymentMethod: string; // CASH | CARD | CREDIT | INSURANCE
  insuranceCoverMinor: number;
  occurredOn: string;
}

/**
 * Build the GL voucher for a dispense. Revenue side: Dr the money owed (clearing for CASH/CARD, else
 * receivable; an insurer-covered portion always lands on receivable), Cr revenue (net of tax) [+ Cr
 * tax]. Cost side: Dr COGS / Cr inventory. A RETURNED/VOID dispense reverses every entry. Returns null
 * when the minimum accounts (a debtor + revenue) aren't configured or the total is zero, so the caller
 * skips posting. Always balanced: Σ debit = Σ credit.
 */
export function pharmacyDispenseVoucher(a: PharmacyGlAccounts, d: DispenseForGl): GlVoucher | null {
  const onCredit = d.paymentMethod === 'CREDIT' || d.paymentMethod === 'INSURANCE';
  const cashAccount = onCredit ? a.receivableAccountId : a.clearingAccountId;
  const debtor = cashAccount ?? a.receivableAccountId ?? a.clearingAccountId;
  if (!debtor || !a.revenueAccountId || d.totalMinor <= 0) return null;

  const reverse = d.status === 'RETURNED' || d.status === 'VOID';
  const dr = (accountId: string, amount: number): GlEntry =>
    reverse ? { accountId, creditMinor: amount } : { accountId, debitMinor: amount };
  const cr = (accountId: string, amount: number): GlEntry =>
    reverse ? { accountId, debitMinor: amount } : { accountId, creditMinor: amount };

  const taxEff = a.taxAccountId ? d.taxMinor : 0;
  const insurance = Math.min(Math.max(d.insuranceCoverMinor, 0), d.totalMinor);
  const direct = d.totalMinor - insurance;

  const entries: GlEntry[] = [];
  // Money owed — split between the insurer receivable and the direct debtor when there's a co-pay.
  if (insurance > 0 && a.receivableAccountId) {
    entries.push(dr(a.receivableAccountId, insurance));
    if (direct > 0) entries.push(dr(debtor, direct));
  } else {
    entries.push(dr(debtor, d.totalMinor));
  }
  entries.push(cr(a.revenueAccountId, d.totalMinor - taxEff));
  if (taxEff > 0 && a.taxAccountId) entries.push(cr(a.taxAccountId, taxEff));
  // Cost side.
  if (d.cogsMinor > 0 && a.cogsAccountId && a.inventoryAccountId) {
    entries.push(dr(a.cogsAccountId, d.cogsMinor), cr(a.inventoryAccountId, d.cogsMinor));
  }

  return {
    description: `Pharmacy ${d.dispenseNo}`,
    voucherType: 'JV',
    occurredOn: d.occurredOn,
    reference: d.dispenseNo,
    entries,
  };
}
