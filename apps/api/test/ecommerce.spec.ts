import { describe, expect, it } from 'vitest';
import {
  computeOrderTotals,
  discountMinorFor,
  ecOrderVoucher,
  priceLine,
  shippingFor,
  slugify,
} from '../src/modules/ecommerce/ecommerce.util';

const line = (qty: number, unit: number, tax = 0) =>
  priceLine({ ecProductId: 'p', productId: 'i', title: 't', quantity: qty, unitPriceMinor: unit, taxRate: tax });

describe('ecommerce.util pricing', () => {
  it('priceLine: gross × qty, floored tax on gross, line total = gross + tax', () => {
    expect(line(3, 1000, 0)).toMatchObject({ taxMinor: 0, lineTotalMinor: 3000 });
    expect(line(2, 1000, 17)).toMatchObject({ taxMinor: 340, lineTotalMinor: 2340 });
    // floor: 1500 × 17% = 255 exactly; 999 × 17% = 169.83 → 169
    expect(line(1, 999, 17).taxMinor).toBe(169);
  });

  it('discountMinorFor: percent + fixed, clamped to subtotal', () => {
    expect(discountMinorFor({ type: 'PERCENT', value: 10 }, 5000)).toBe(500);
    expect(discountMinorFor({ type: 'FIXED', value: 1500 }, 5000)).toBe(1500);
    expect(discountMinorFor({ type: 'FIXED', value: 9999 }, 5000)).toBe(5000); // never exceeds subtotal
    expect(discountMinorFor(null, 5000)).toBe(0);
  });

  it('shippingFor: flat rate, free over the threshold', () => {
    expect(shippingFor(3000, 300, 5000)).toBe(300);
    expect(shippingFor(6000, 300, 5000)).toBe(0);
    expect(shippingFor(3000, 300, null)).toBe(300);
  });

  it('computeOrderTotals: subtotal − discount + tax + shipping', () => {
    const lines = [line(2, 1000, 10), line(1, 2000, 10)]; // subtotal 4000, tax 200+200=400
    const t = computeOrderTotals(lines, { type: 'PERCENT', value: 25 }, 300);
    expect(t).toEqual({ subtotalMinor: 4000, discountMinor: 1000, taxMinor: 400, shippingMinor: 300, totalMinor: 3700 });
  });

  it('slugify: lowercase, hyphenated, trimmed', () => {
    expect(slugify('Red T-Shirt (Large)!')).toBe('red-t-shirt-large');
  });
});

describe('ecommerce.util GL voucher', () => {
  const accounts = {
    clearingAccountId: 'clear', revenueAccountId: 'rev', taxAccountId: 'tax',
    cogsAccountId: 'cogs', inventoryAccountId: 'inv', shippingAccountId: 'ship',
  };
  const order = {
    orderNo: 'ORD-1', subtotalMinor: 4000, discountMinor: 1000, taxMinor: 400,
    shippingMinor: 300, totalMinor: 3700, cogsMinor: 1200, occurredOn: '2026-06-17',
  };

  it('builds a balanced voucher: Σ debit = Σ credit', () => {
    const v = ecOrderVoucher(accounts, order)!;
    const dr = v.entries.reduce((s, e) => s + (e.debitMinor ?? 0), 0);
    const cr = v.entries.reduce((s, e) => s + (e.creditMinor ?? 0), 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(order.totalMinor + order.cogsMinor); // 3700 + 1200
    // revenue = merchandise (subtotal − discount) = 3000; tax 400; shipping 300 booked separately
    expect(v.entries.find((e) => e.accountId === 'rev')?.creditMinor).toBe(3000);
    expect(v.entries.find((e) => e.accountId === 'tax')?.creditMinor).toBe(400);
    expect(v.entries.find((e) => e.accountId === 'ship')?.creditMinor).toBe(300);
  });

  it('folds tax + shipping into revenue when those accounts are absent', () => {
    const v = ecOrderVoucher({ ...accounts, taxAccountId: null, shippingAccountId: null }, order)!;
    const cr = v.entries.reduce((s, e) => s + (e.creditMinor ?? 0), 0);
    const dr = v.entries.reduce((s, e) => s + (e.debitMinor ?? 0), 0);
    expect(dr).toBe(cr);
    expect(v.entries.find((e) => e.accountId === 'rev')?.creditMinor).toBe(3700); // 3000 + 400 + 300
    expect(v.entries.some((e) => e.accountId === 'tax')).toBe(false);
  });

  it('returns null without the minimum accounts or a zero total', () => {
    expect(ecOrderVoucher({ ...accounts, clearingAccountId: null }, order)).toBeNull();
    expect(ecOrderVoucher(accounts, { ...order, totalMinor: 0 })).toBeNull();
  });
});
