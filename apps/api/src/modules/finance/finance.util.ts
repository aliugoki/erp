/**
 * Pure finance invariants (Chunk 3.2). All amounts are integer minor units — these helpers reject
 * anything else, so money is never represented as a float (ADR-007).
 */

export interface JournalEntryInput {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
}

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPriceMinor: number;
}

/** Thrown when a transaction's journal entries are invalid or unbalanced. Mapped to HTTP 422. */
export class UnbalancedTransactionError extends Error {}

const isMinor = (n: number): boolean => Number.isInteger(n);

/**
 * Enforce double-entry: ≥2 entries, each a debit XOR a credit on non-negative INTEGER minor units,
 * and sum(debits) === sum(credits). Throws UnbalancedTransactionError otherwise.
 */
export function assertBalanced(entries: JournalEntryInput[]): { debit: number; credit: number } {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new UnbalancedTransactionError('A transaction needs at least two journal entries');
  }
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    const d = e.debitMinor ?? 0;
    const c = e.creditMinor ?? 0;
    if (!isMinor(d) || !isMinor(c)) {
      throw new UnbalancedTransactionError('Amounts must be integer minor units (no floats)');
    }
    if (d < 0 || c < 0) throw new UnbalancedTransactionError('Amounts must be non-negative');
    if (d > 0 && c > 0) throw new UnbalancedTransactionError('An entry is a debit or a credit, not both');
    if (d === 0 && c === 0) throw new UnbalancedTransactionError('An entry must have a debit or a credit');
    debit += d;
    credit += c;
  }
  if (debit !== credit) {
    throw new UnbalancedTransactionError(`Unbalanced transaction: debits ${debit} ≠ credits ${credit}`);
  }
  return { debit, credit };
}

// ── Chart-of-accounts depth & voucher types ──────────────────────────────────────────────────────

/** The classic 4-level chart of accounts: Main head → Control → Subsidiary → Detail. */
export const MAX_ACCOUNT_LEVELS = 4;

/** Voucher (transaction) types. BRV/CRV bring money in; BPV/CPV pay money out; JV is general. */
export const VOUCHER_TYPES = ['BRV', 'BPV', 'CPV', 'CRV', 'JV'] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

const VOUCHER_LABELS: Record<VoucherType, string> = {
  BRV: 'Bank Receipt Voucher',
  BPV: 'Bank Payment Voucher',
  CPV: 'Cash Payment Voucher',
  CRV: 'Cash Receipt Voucher',
  JV: 'Journal Voucher',
};
export function voucherLabel(t: VoucherType): string {
  return VOUCHER_LABELS[t];
}

/** Format a per-type running number as a zero-padded voucher number, e.g. (BRV, 42) -> "BRV-000042". */
export function formatVoucherNo(type: VoucherType, n: number): string {
  return `${type}-${String(n).padStart(6, '0')}`;
}

/** How an account participates in cash/bank books and voucher validation. */
export type ControlType = 'NONE' | 'CASH' | 'BANK';
export const CONTROL_TYPES: ControlType[] = ['NONE', 'CASH', 'BANK'];

/** Thrown when a voucher's lines don't match its type's cash/bank rule. Mapped to HTTP 422. */
export class VoucherValidationError extends Error {}

export interface VoucherLine {
  controlType: ControlType;
  debitMinor: number;
  creditMinor: number;
}

/**
 * Enforce the cash/bank semantics of a voucher type:
 *  - BRV (Bank Receipt)  → must DEBIT a bank account (money into the bank)
 *  - BPV (Bank Payment)  → must CREDIT a bank account (money out of the bank)
 *  - CRV (Cash Receipt)  → must DEBIT a cash account
 *  - CPV (Cash Payment)  → must CREDIT a cash account
 *  - JV  (Journal)       → no cash/bank constraint
 * The double-entry balance is checked separately (assertBalanced).
 */
export function assertVoucherType(type: VoucherType, lines: VoucherLine[]): void {
  const has = (control: ControlType, side: 'debit' | 'credit') =>
    lines.some((l) => l.controlType === control && (side === 'debit' ? l.debitMinor > 0 : l.creditMinor > 0));
  switch (type) {
    case 'BRV':
      if (!has('BANK', 'debit')) throw new VoucherValidationError('A Bank Receipt Voucher must debit a bank account');
      break;
    case 'BPV':
      if (!has('BANK', 'credit')) throw new VoucherValidationError('A Bank Payment Voucher must credit a bank account');
      break;
    case 'CRV':
      if (!has('CASH', 'debit')) throw new VoucherValidationError('A Cash Receipt Voucher must debit a cash account');
      break;
    case 'CPV':
      if (!has('CASH', 'credit')) throw new VoucherValidationError('A Cash Payment Voucher must credit a cash account');
      break;
    case 'JV':
      break;
  }
}

// ── Account-type accounting semantics (pure; used by GL / trial balance / statements) ────────────

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

/** The side an account type normally carries. Assets & expenses are debit-normal; the rest credit. */
export function normalBalance(type: AccountType): 'DEBIT' | 'CREDIT' {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

/**
 * Net balance of an account in its NATURAL direction (always integer minor units): positive means a
 * normal balance, negative an abnormal one. Debit-normal = debit − credit; credit-normal = credit −
 * debit. So an asset with more debits is positive, a revenue with more credits is positive.
 */
export function signedBalanceMinor(type: AccountType, debitMinor: number, creditMinor: number): number {
  const raw = debitMinor - creditMinor; // debit-positive
  return normalBalance(type) === 'DEBIT' ? raw : -raw;
}

/**
 * Place a debit-positive net onto the two trial-balance columns: a positive net is a debit-side
 * balance, a negative net a credit-side balance. Sum of all debitMinor === sum of all creditMinor
 * across a complete set, because every posted entry balances.
 */
export function trialColumns(netDebitMinor: number): { debitMinor: number; creditMinor: number } {
  return netDebitMinor >= 0
    ? { debitMinor: netDebitMinor, creditMinor: 0 }
    : { debitMinor: 0, creditMinor: -netDebitMinor };
}

/** Compute invoice subtotal/total from line items (integer math only). */
export function computeInvoiceTotals(
  lines: InvoiceLineInput[],
  taxMinor = 0,
): { subtotalMinor: number; taxMinor: number; totalMinor: number } {
  if (!isMinor(taxMinor) || taxMinor < 0) {
    throw new UnbalancedTransactionError('Tax must be a non-negative integer minor amount');
  }
  let subtotalMinor = 0;
  for (const line of lines) {
    if (!isMinor(line.quantity) || !isMinor(line.unitPriceMinor)) {
      throw new UnbalancedTransactionError('Line quantity and unit price must be integers');
    }
    subtotalMinor += line.quantity * line.unitPriceMinor;
  }
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}
