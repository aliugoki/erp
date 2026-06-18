import { describe, expect, it } from 'vitest';
import {
  type OrderEmailInfo,
  computeOrderTotals,
  customerOrderEmail,
  discountMinorFor,
  ecOrderVoucher,
  priceLine,
  shippingFor,
  slugify,
} from '../src/modules/ecommerce/ecommerce.util';
import { newClientSecret, signWebhook, verifyWebhook } from '../src/modules/ecommerce/payment.util';

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

describe('ecommerce.util customer emails', () => {
  const info: OrderEmailInfo = {
    orderNo: 'ORD-000007', customerName: 'Ada Lovelace', customerEmail: 'ada@buyer.test', status: 'PENDING',
    paymentMethod: 'COD', paymentStatus: 'UNPAID', totalMinor: 480_000, currency: 'PKR', lineCount: 2, storeName: 'Shop Co',
  };

  it('placed confirmation names the order, total, store, and payment expectation', () => {
    const cod = customerOrderEmail(info, 'placed')!;
    expect(cod.subject).toBe('Shop Co — order ORD-000007 confirmed');
    expect(cod.text).toContain('PKR 4,800.00');
    expect(cod.text).toContain('pay on delivery');
    const paid = customerOrderEmail({ ...info, paymentStatus: 'PAID' }, 'placed')!;
    expect(paid.text).toContain('payment has been received');
  });

  it('status emails are sent only for notable statuses', () => {
    expect(customerOrderEmail(info, 'SHIPPED')!.subject).toContain('shipped');
    expect(customerOrderEmail(info, 'PAID')!.text).toContain('being prepared');
    expect(customerOrderEmail(info, 'CANCELLED')!.subject).toContain('cancelled');
    expect(customerOrderEmail({ ...info, status: 'REFUNDED' }, 'REFUNDED')!.text).toContain('refund of PKR 4,800.00');
    expect(customerOrderEmail(info, 'PENDING')).toBeNull(); // no email for a return-to-pending
    expect(customerOrderEmail(info, 'WHATEVER')).toBeNull();
  });
});

describe('ecommerce payment webhook signing', () => {
  it('verifyWebhook accepts a matching HMAC and rejects tampering', () => {
    const secret = 'a-shared-gateway-secret';
    const data = 'pay-123.PAID';
    const sig = signWebhook(secret, data);
    expect(verifyWebhook(secret, data, sig)).toBe(true);
    expect(verifyWebhook(secret, 'pay-123.FAILED', sig)).toBe(false); // status tampered
    expect(verifyWebhook('other-secret', data, sig)).toBe(false); // wrong secret
    expect(verifyWebhook(secret, data, 'deadbeef')).toBe(false); // forged signature
  });

  it('newClientSecret returns a high-entropy hex string', () => {
    const a = newClientSecret();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(newClientSecret()).not.toBe(a);
  });
});
