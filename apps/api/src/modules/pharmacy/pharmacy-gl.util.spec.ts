import { describe, expect, it } from 'vitest';
import {
  type AdjustmentForGl,
  type DispenseForGl,
  type PharmacyGlAccounts,
  pharmacyAdjustmentVoucher,
  pharmacyDispenseVoucher,
} from './pharmacy-gl.util';

const accounts: PharmacyGlAccounts = {
  clearingAccountId: 'clearing',
  receivableAccountId: 'ar',
  revenueAccountId: 'revenue',
  taxAccountId: 'tax',
  discountAccountId: 'disc',
  cogsAccountId: 'cogs',
  inventoryAccountId: 'inv',
  writeoffAccountId: 'wo',
};

const base: DispenseForGl = {
  dispenseNo: 'DSP-000001',
  type: 'RETAIL_SALE',
  status: 'COMPLETED',
  totalMinor: 10500, // 100 net + 5 tax
  taxMinor: 500,
  cogsMinor: 6000,
  paymentMethod: 'CASH',
  insuranceCoverMinor: 0,
  occurredOn: '2026-06-22',
};

const sum = (entries: { debitMinor?: number; creditMinor?: number }[]) => ({
  dr: entries.reduce((s, e) => s + (e.debitMinor ?? 0), 0),
  cr: entries.reduce((s, e) => s + (e.creditMinor ?? 0), 0),
});

describe('pharmacyDispenseVoucher', () => {
  it('builds a balanced cash sale: Dr clearing, Cr revenue+tax, Dr COGS / Cr inventory', () => {
    const v = pharmacyDispenseVoucher(accounts, base)!;
    expect(v).not.toBeNull();
    const { dr, cr } = sum(v.entries);
    expect(dr).toBe(cr); // balanced
    expect(dr).toBe(10500 + 6000); // total + cogs on each side
    expect(v.entries.find((e) => e.accountId === 'clearing')?.debitMinor).toBe(10500);
    expect(v.entries.find((e) => e.accountId === 'revenue')?.creditMinor).toBe(10000);
    expect(v.entries.find((e) => e.accountId === 'tax')?.creditMinor).toBe(500);
    expect(v.entries.find((e) => e.accountId === 'cogs')?.debitMinor).toBe(6000);
  });

  it('debits receivable (not clearing) on CREDIT terms', () => {
    const v = pharmacyDispenseVoucher(accounts, { ...base, paymentMethod: 'CREDIT' })!;
    expect(v.entries.find((e) => e.accountId === 'ar')?.debitMinor).toBe(10500);
    expect(v.entries.some((e) => e.accountId === 'clearing')).toBe(false);
  });

  it('splits an insurance co-pay across receivable + the direct debtor', () => {
    const v = pharmacyDispenseVoucher(accounts, { ...base, paymentMethod: 'INSURANCE', insuranceCoverMinor: 8000 })!;
    expect(v.entries.find((e) => e.accountId === 'ar')?.debitMinor).toBe(8000);
    const { dr, cr } = sum(v.entries);
    expect(dr).toBe(cr);
  });

  it('reverses every entry for a RETURNED dispense', () => {
    const v = pharmacyDispenseVoucher(accounts, { ...base, status: 'RETURNED' })!;
    expect(v.entries.find((e) => e.accountId === 'clearing')?.creditMinor).toBe(10500);
    expect(v.entries.find((e) => e.accountId === 'revenue')?.debitMinor).toBe(10000);
    const { dr, cr } = sum(v.entries);
    expect(dr).toBe(cr);
  });

  it('returns null when revenue/debtor accounts are missing or total is zero', () => {
    expect(pharmacyDispenseVoucher({ ...accounts, revenueAccountId: null }, base)).toBeNull();
    expect(pharmacyDispenseVoucher({ ...accounts, clearingAccountId: null, receivableAccountId: null }, base)).toBeNull();
    expect(pharmacyDispenseVoucher(accounts, { ...base, totalMinor: 0 })).toBeNull();
  });

  it('omits the cost side when COGS or its accounts are absent', () => {
    const v = pharmacyDispenseVoucher({ ...accounts, cogsAccountId: null }, base)!;
    expect(v.entries.some((e) => e.accountId === 'cogs')).toBe(false);
    const { dr, cr } = sum(v.entries);
    expect(dr).toBe(cr);
    expect(dr).toBe(10500);
  });
});

describe('pharmacyAdjustmentVoucher', () => {
  const adj = (over: Partial<AdjustmentForGl>): AdjustmentForGl => ({
    adjNo: 'WOF-000001', type: 'WRITEOFF', valueMinor: 5000, occurredOn: '2026-06-22', ...over,
  });

  it('write-off (inventory decreased): Dr write-off / Cr inventory, balanced', () => {
    const v = pharmacyAdjustmentVoucher(accounts, adj({ type: 'WRITEOFF', valueMinor: 5000 }))!;
    expect(v.entries.find((e) => e.accountId === 'wo')?.debitMinor).toBe(5000);
    expect(v.entries.find((e) => e.accountId === 'inv')?.creditMinor).toBe(5000);
    const { dr, cr } = sum(v.entries);
    expect(dr).toBe(cr);
  });

  it('return-to-vendor debits clearing (not write-off)', () => {
    const v = pharmacyAdjustmentVoucher(accounts, adj({ type: 'RTV', valueMinor: 3000 }))!;
    expect(v.entries.find((e) => e.accountId === 'clearing')?.debitMinor).toBe(3000);
    expect(v.entries.find((e) => e.accountId === 'inv')?.creditMinor).toBe(3000);
  });

  it('a write-up (negative value) reverses to Dr inventory / Cr write-off', () => {
    const v = pharmacyAdjustmentVoucher(accounts, adj({ type: 'ADJUST', valueMinor: -2000 }))!;
    expect(v.entries.find((e) => e.accountId === 'inv')?.debitMinor).toBe(2000);
    expect(v.entries.find((e) => e.accountId === 'wo')?.creditMinor).toBe(2000);
  });

  it('returns null when inventory/counter accounts are missing or value is zero', () => {
    expect(pharmacyAdjustmentVoucher({ ...accounts, inventoryAccountId: null }, adj({}))).toBeNull();
    expect(pharmacyAdjustmentVoucher({ ...accounts, writeoffAccountId: null }, adj({ type: 'WRITEOFF' }))).toBeNull();
    expect(pharmacyAdjustmentVoucher(accounts, adj({ valueMinor: 0 }))).toBeNull();
  });
});
