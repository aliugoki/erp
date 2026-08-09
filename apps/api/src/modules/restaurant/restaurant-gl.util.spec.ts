import { describe, expect, it } from 'vitest';
import type { RestaurantBillSettledV1 } from '@metaxperts/shared';
import { type RestaurantGlAccounts, restaurantBillVoucher, voucherTotals } from './restaurant-gl.util';

const ACCOUNTS: RestaurantGlAccounts = {
  revenueAccountId: 'rev', taxAccountId: 'tax', cogsAccountId: 'cogs', inventoryAccountId: 'inv',
  cashAccountId: 'cash', bankAccountId: 'bank', cardClearingAccountId: 'card', walletClearingAccountId: 'wallet',
  giftCardLiabilityAccountId: 'gift', discountAccountId: 'disc', serviceChargeAccountId: 'svc',
  tipsPayableAccountId: 'tips', roundingAccountId: 'round', receivableAccountId: 'ar',
};

const bill = (over: Partial<RestaurantBillSettledV1> = {}): RestaurantBillSettledV1 => ({
  orderId: 'o1', orderNo: 'ORD-000001', branchId: null, channel: 'DINE_IN', customerId: null,
  subtotalMinor: 100000, discountMinor: 0, serviceChargeMinor: 0, taxMinor: 0, tipMinor: 0, roundingMinor: 0,
  totalMinor: 100000, cogsMinor: 0, currency: 'PKR', payments: [{ method: 'CASH', amountMinor: 100000, tipMinor: 0 }],
  ...over,
});

describe('restaurantBillVoucher', () => {
  it('returns null when revenue is unconfigured or total is non-positive', () => {
    expect(restaurantBillVoucher({ ...ACCOUNTS, revenueAccountId: null }, bill(), '2026-07-21')).toBeNull();
    expect(restaurantBillVoucher(ACCOUNTS, bill({ totalMinor: 0 }), '2026-07-21')).toBeNull();
  });

  it('posts a simple cash sale: Dr cash / Cr revenue, balanced', () => {
    const v = restaurantBillVoucher(ACCOUNTS, bill(), '2026-07-21')!;
    const t = voucherTotals(v);
    expect(t.debit).toBe(100000);
    expect(t.credit).toBe(100000);
    expect(v.entries).toContainEqual({ accountId: 'cash', debitMinor: 100000 });
    expect(v.entries).toContainEqual({ accountId: 'rev', creditMinor: 100000 });
  });

  it('splits tax, service charge and COGS while staying balanced', () => {
    const v = restaurantBillVoucher(
      ACCOUNTS,
      bill({ subtotalMinor: 100000, taxMinor: 16000, serviceChargeMinor: 10000, totalMinor: 126000, cogsMinor: 40000, payments: [{ method: 'CARD', amountMinor: 126000, tipMinor: 0 }] }),
      '2026-07-21',
    )!;
    const t = voucherTotals(v);
    expect(t.debit).toBe(t.credit);
    expect(t.debit).toBe(126000 + 40000); // sale side + cost side
    expect(v.entries).toContainEqual({ accountId: 'card', debitMinor: 126000 });
    expect(v.entries).toContainEqual({ accountId: 'tax', creditMinor: 16000 });
    expect(v.entries).toContainEqual({ accountId: 'svc', creditMinor: 10000 });
    expect(v.entries).toContainEqual({ accountId: 'cogs', debitMinor: 40000 });
    expect(v.entries).toContainEqual({ accountId: 'inv', creditMinor: 40000 });
  });

  it('nets cash change so debits equal the bill total (overpaid cash)', () => {
    const v = restaurantBillVoucher(
      ACCOUNTS,
      bill({ totalMinor: 100000, payments: [{ method: 'CASH', amountMinor: 150000, tipMinor: 0 }] }),
      '2026-07-21',
    )!;
    const t = voucherTotals(v);
    expect(t.debit).toBe(100000); // change of 50000 netted off
    expect(t.credit).toBe(100000);
  });

  it('books tip to tips-payable and a negative rounding as a debit, balanced', () => {
    const v = restaurantBillVoucher(
      ACCOUNTS,
      bill({ subtotalMinor: 100000, tipMinor: 5000, roundingMinor: -50, totalMinor: 104950, payments: [{ method: 'CASH', amountMinor: 104950, tipMinor: 5000 }] }),
      '2026-07-21',
    )!;
    const t = voucherTotals(v);
    expect(t.debit).toBe(t.credit);
    expect(v.entries).toContainEqual({ accountId: 'tips', creditMinor: 5000 });
    expect(v.entries).toContainEqual({ accountId: 'round', debitMinor: 50 });
  });

  it('falls back to revenue when a dedicated credit account is missing, still balanced', () => {
    const v = restaurantBillVoucher(
      { ...ACCOUNTS, taxAccountId: null, tipsPayableAccountId: null },
      bill({ subtotalMinor: 100000, taxMinor: 16000, tipMinor: 4000, totalMinor: 120000, payments: [{ method: 'CASH', amountMinor: 120000, tipMinor: 4000 }] }),
      '2026-07-21',
    )!;
    const t = voucherTotals(v);
    expect(t.debit).toBe(120000);
    expect(t.credit).toBe(120000);
  });
});
