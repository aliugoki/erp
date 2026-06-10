import type { Money } from '@metaxperts/shared';

export type MovementType = 'IN' | 'OUT' | 'TRANSFER';

/** Net change to a product's total on-hand for a movement. TRANSFER moves between warehouses, so
 * the product-level total is unchanged. */
export function deltaFor(type: MovementType, quantity: number): number {
  if (type === 'IN') return quantity;
  if (type === 'OUT') return -quantity;
  return 0; // TRANSFER
}

/** True when a movement causes on-hand to cross from at-or-above min_stock to below it. */
export function isLowStockTransition(current: number, next: number, minStock: number): boolean {
  return current >= minStock && next < minStock;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  cost_price_minor: string | number;
  sell_price_minor: string | number;
  currency: string;
  min_stock: number;
  on_hand: number;
}

export interface ProductView {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  costPrice: Money;
  sellPrice: Money;
  minStock: number;
  onHand: number;
}

export function mapProductRow(r: ProductRow): ProductView {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unit: r.unit,
    costPrice: { amountMinor: Number(r.cost_price_minor), currency: r.currency },
    sellPrice: { amountMinor: Number(r.sell_price_minor), currency: r.currency },
    minStock: r.min_stock,
    onHand: r.on_hand,
  };
}
