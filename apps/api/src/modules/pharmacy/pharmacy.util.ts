/** Format a per-tenant document number, e.g. RCV-000004. */
export function formatDocNo(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

/** Doc-type → number prefix for the running counter. */
export const DOC_PREFIX = {
  RCV: 'RCV', // batch receipt
  DSP: 'DSP', // dispense / sale
  RTV: 'RTV', // return to vendor
  WOF: 'WOF', // expiry write-off
  ADJ: 'PADJ', // stock adjustment
} as const;

export type Row = Record<string, unknown>;

export function money(v: unknown, currency = 'PKR') {
  return { amountMinor: Number(v ?? 0), currency };
}

/** A stock lot as the FEFO allocator needs to see it. */
export interface LotLike {
  id: string;
  lotNo: string;
  expiryDate: string | null;
  qtyOnHand: number;
  unitCostMinor: number;
  receivedOn?: string | null;
}

export interface Allocation {
  lotId: string;
  lotNo: string;
  expiryDate: string | null;
  qty: number;
  unitCostMinor: number;
}

/**
 * First-Expiry-First-Out allocation. Picks across lots in expiry order (soonest first; lots with no
 * expiry last, then by receipt/`id` for a stable order) until `qty` is satisfied. Returns the picks
 * and the total cost consumed (sum of qty×unitCost) — use that as COGS. Throws when the available
 * quantity is insufficient (unless `allowShort`, which returns whatever could be allocated).
 */
export function allocateFefo(
  lots: LotLike[],
  qty: number,
  allowShort = false,
): { allocations: Allocation[]; costMinor: number; shortBy: number } {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('quantity must be a positive integer');
  const ordered = [...lots]
    .filter((l) => l.qtyOnHand > 0)
    .sort((a, b) => {
      const ax = a.expiryDate ?? '9999-12-31';
      const bx = b.expiryDate ?? '9999-12-31';
      if (ax !== bx) return ax < bx ? -1 : 1;
      const ar = a.receivedOn ?? '';
      const br = b.receivedOn ?? '';
      if (ar !== br) return ar < br ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  const allocations: Allocation[] = [];
  let remaining = qty;
  let costMinor = 0;
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.qtyOnHand);
    allocations.push({
      lotId: lot.id,
      lotNo: lot.lotNo,
      expiryDate: lot.expiryDate,
      qty: take,
      unitCostMinor: lot.unitCostMinor,
    });
    costMinor += take * lot.unitCostMinor;
    remaining -= take;
  }

  if (remaining > 0 && !allowShort) {
    throw new InsufficientStockError(qty, qty - remaining);
  }
  return { allocations, costMinor, shortBy: Math.max(0, remaining) };
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(`Insufficient stock: requested ${requested}, available ${available}`);
    this.name = 'InsufficientStockError';
  }
}
