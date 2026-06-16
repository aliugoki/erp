import { describe, expect, it } from 'vitest';
import {
  buildCategoryPath,
  deltaFor,
  isLowStockTransition,
  mapProductRow,
} from '../src/modules/inventory/inventory.util';
import {
  buildCategoryTree,
  type CategoryView,
} from '../src/modules/inventory/inventory-categories.service';

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
    expect(v.categoryId).toBeNull();
    expect(v.categoryPath).toEqual([]);
  });

  it('buildCategoryPath orders names top→leaf and drops missing levels', () => {
    expect(buildCategoryPath('Electronics', 'Phones', 'Smartphones')).toEqual([
      'Electronics',
      'Phones',
      'Smartphones',
    ]);
    expect(buildCategoryPath(null, null, 'Electronics')).toEqual(['Electronics']);
    expect(buildCategoryPath(null, 'Phones', 'Smartphones')).toEqual(['Phones', 'Smartphones']);
    expect(buildCategoryPath(null, null, null)).toEqual([]);
  });

  it('mapProductRow surfaces the joined category path and id', () => {
    const v = mapProductRow({
      id: 'p1', sku: 'SKU-1', name: 'iPhone', category: null, unit: 'unit',
      cost_price_minor: '0', sell_price_minor: '0', currency: 'PKR', min_stock: 0, on_hand: 0,
      category_id: 'c3', category_name: 'Smartphones', parent_name: 'Phones', grandparent_name: 'Electronics',
    });
    expect(v.categoryId).toBe('c3');
    expect(v.categoryPath).toEqual(['Electronics', 'Phones', 'Smartphones']);
  });
});

describe('inventory categories', () => {
  const cat = (over: Partial<CategoryView>): CategoryView => ({
    id: 'x', name: 'X', code: null, parentId: null, level: 1, childCount: 0, productCount: 0, ...over,
  });

  it('buildCategoryTree nests a flat list into roots → children → grandchildren', () => {
    const flat: CategoryView[] = [
      cat({ id: 'a', name: 'Electronics', level: 1 }),
      cat({ id: 'b', name: 'Phones', level: 2, parentId: 'a' }),
      cat({ id: 'c', name: 'Smartphones', level: 3, parentId: 'b' }),
      cat({ id: 'd', name: 'Furniture', level: 1 }),
    ];
    const tree = buildCategoryTree(flat);
    expect(tree.map((n) => n.name).sort()).toEqual(['Electronics', 'Furniture']);
    const electronics = tree.find((n) => n.id === 'a')!;
    expect(electronics.children.map((n) => n.id)).toEqual(['b']);
    expect(electronics.children[0]!.children.map((n) => n.id)).toEqual(['c']);
  });

  it('buildCategoryTree treats an orphaned node (missing parent) as a root', () => {
    const tree = buildCategoryTree([cat({ id: 'b', parentId: 'missing', level: 2 })]);
    expect(tree.map((n) => n.id)).toEqual(['b']);
  });
});
