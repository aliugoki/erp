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
