import { describe, expect, it } from 'vitest';
import {
  dealWonDraft,
  formatMinor,
  invoicePaidDraft,
  lowStockDraft,
  payrollDraft,
  productionCompletedDraft,
} from '../src/modules/notifications/notifications.util';

describe('notifications.util', () => {
  it('formatMinor renders integer minor units as major with the currency', () => {
    expect(formatMinor(2_500_000, 'PKR')).toBe('PKR 25,000.00');
    expect(formatMinor(999, 'USD')).toBe('USD 9.99');
  });

  it('dealWonDraft keeps the type + title contract the e2e pins', () => {
    const d = dealWonDraft({ dealId: 'd', title: 'Mega Deal', clientId: 'c', valueMinor: 2_500_000, currency: 'PKR' });
    expect(d.type).toBe('crm.deal_won');
    expect(d.title).toBe('Deal won: Mega Deal');
    expect(d.severity).toBe('SUCCESS');
    expect(d.category).toBe('crm');
    expect(d.link).toBe('/crm');
  });

  it('lowStockDraft is a warning naming the product + thresholds', () => {
    const d = lowStockDraft({ productId: 'p', onHand: 3, minStock: 10 }, 'Widget');
    expect(d.type).toBe('inventory.low_stock');
    expect(d.title).toBe('Low stock: Widget');
    expect(d.body).toContain('3');
    expect(d.body).toContain('10');
    expect(d.severity).toBe('WARNING');
    expect(d.category).toBe('inventory');
    expect(lowStockDraft({ productId: 'p', onHand: 0, minStock: 5 }).title).toBe('Low stock: product');
  });

  it('invoicePaid / payroll / production drafts carry the right category + money', () => {
    expect(invoicePaidDraft({ invoiceId: 'i', number: 'INV-1', clientId: null, totalMinor: 50_000, currency: 'PKR' }).category).toBe('finance');
    expect(payrollDraft({ runId: 'r', periodYear: 2026, periodMonth: 6, employeeCount: 12, totalNetMinor: 1_000_000, currency: 'PKR' }).title).toBe('Payroll completed: 2026-06');
    const prod = productionCompletedDraft({ orderId: 'o', orderNo: 'MO-1', productId: 'p', producedQty: 5, materialCostMinor: 0, operationCostMinor: 0, overheadMinor: 0, totalCostMinor: 0, unitCostMinor: 110_000, currency: 'PKR' });
    expect(prod.category).toBe('production');
    expect(prod.body).toContain('5 unit');
    expect(prod.body).toContain('1,100.00');
  });
});
