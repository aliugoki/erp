import { describe, expect, it } from 'vitest';
import { deltaFor, isLowStockTransition, mapProductRow } from '../src/modules/inventory/inventory.util';

describe('inventory.util', () => {
  it('deltaFor: IN adds, OUT subtracts, TRANSFER is net-zero at product level', () => {
    expect(deltaFor('IN', 5)).toBe(5);
    expect(deltaFor('OUT', 5)).toBe(-5);
    expect(deltaFor('TRANSFER', 5)).toBe(0);
  });

  it('isLowStockTransition fires only on crossing below the reorder point', () => {
    expect(isLowStockTransition(15, 7, 10)).toBe(true); // 15 -> 7, min 10
    expect(isLowStockTransition(7, 5, 10)).toBe(false); // already below
    expect(isLowStockTransition(20, 12, 10)).toBe(false); // stays above
    expect(isLowStockTransition(10, 9, 10)).toBe(true); // at min -> below
  });

  it('mapProductRow exposes prices as Money (integer minor units)', () => {
    const v = mapProductRow({
      id: 'p1', sku: 'SKU-1', name: 'Bolt', category: null, unit: 'box',
      cost_price_minor: '12000', sell_price_minor: '20000', currency: 'PKR', min_stock: 10, on_hand: 3,
    });
    expect(v.costPrice).toEqual({ amountMinor: 12000, currency: 'PKR' });
    expect(v.sellPrice).toEqual({ amountMinor: 20000, currency: 'PKR' });
    expect(v.onHand).toBe(3);
  });
});
