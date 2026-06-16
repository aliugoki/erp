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
  // Optional — present only on the category-joined SELECT, absent on bare INSERT…RETURNING.
  category_id?: string | null;
  category_name?: string | null;
  parent_name?: string | null;
  grandparent_name?: string | null;
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
  categoryId: string | null;
  /** The category names from the top of the tree down to the product's category, e.g.
   * `['Electronics', 'Phones', 'Smartphones']`. Empty when the product has no category. */
  categoryPath: string[];
}

/** Build the top→leaf category path for a product from its three joined ancestor name columns.
 * The product's own category is the leaf; `parent_name`/`grandparent_name` walk upward, so they are
 * prepended in reverse to read top-down. Nulls (missing levels) are dropped. */
export function buildCategoryPath(
  grandparentName?: string | null,
  parentName?: string | null,
  categoryName?: string | null,
): string[] {
  return [grandparentName, parentName, categoryName].filter((n): n is string => Boolean(n));
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
    categoryId: r.category_id ?? null,
    categoryPath: buildCategoryPath(r.grandparent_name, r.parent_name, r.category_name),
  };
}
