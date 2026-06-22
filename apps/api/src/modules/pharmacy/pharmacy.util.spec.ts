import { describe, expect, it } from 'vitest';
import { allocateFefo, InsufficientStockError, type LotLike } from './pharmacy.util';

const lot = (id: string, expiry: string | null, qty: number, cost = 100, received?: string): LotLike => ({
  id,
  lotNo: `L-${id}`,
  expiryDate: expiry,
  qtyOnHand: qty,
  unitCostMinor: cost,
  receivedOn: received ?? null,
});

describe('allocateFefo', () => {
  it('consumes the soonest-expiring lot first', () => {
    const lots = [lot('a', '2026-12-31', 10), lot('b', '2026-06-30', 10), lot('c', '2027-01-31', 10)];
    const { allocations, shortBy } = allocateFefo(lots, 8);
    expect(shortBy).toBe(0);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.lotId).toBe('b'); // earliest expiry
    expect(allocations[0]!.qty).toBe(8);
  });

  it('spills across lots in expiry order and sums the cost', () => {
    const lots = [lot('a', '2026-06-30', 5, 100), lot('b', '2026-09-30', 5, 120)];
    const { allocations, costMinor } = allocateFefo(lots, 8);
    expect(allocations.map((a) => [a.lotId, a.qty])).toEqual([
      ['a', 5],
      ['b', 3],
    ]);
    expect(costMinor).toBe(5 * 100 + 3 * 120); // 1100
  });

  it('orders no-expiry lots last, then by receipt date', () => {
    const lots = [lot('noexp', null, 10), lot('soon', '2026-06-30', 3)];
    const { allocations } = allocateFefo(lots, 5);
    expect(allocations[0]!.lotId).toBe('soon');
    expect(allocations[1]!.lotId).toBe('noexp');
    expect(allocations[1]!.qty).toBe(2);
  });

  it('throws InsufficientStockError when short and allowShort is false', () => {
    const lots = [lot('a', '2026-06-30', 3)];
    expect(() => allocateFefo(lots, 10)).toThrow(InsufficientStockError);
  });

  it('returns a partial allocation with shortBy when allowShort is true', () => {
    const lots = [lot('a', '2026-06-30', 3)];
    const { allocations, shortBy } = allocateFefo(lots, 10, true);
    expect(shortBy).toBe(7);
    expect(allocations[0]!.qty).toBe(3);
  });

  it('skips empty lots and rejects non-positive quantities', () => {
    expect(allocateFefo([lot('a', '2026-06-30', 0), lot('b', '2026-07-31', 4)], 4).allocations[0]!.lotId).toBe('b');
    expect(() => allocateFefo([lot('a', null, 5)], 0)).toThrow();
    expect(() => allocateFefo([lot('a', null, 5)], -2)).toThrow();
  });
});
