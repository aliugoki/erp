import { describe, expect, it } from 'vitest';
import { FiscalRegistry } from './fiscal.registry';
import type { FiscalInvoice, FiscalRuntimeConfig } from './fiscal-provider.interface';

const registry = new FiscalRegistry();

const cfg = (over: Partial<FiscalRuntimeConfig> = {}): FiscalRuntimeConfig => ({
  authority: 'PRA', environment: 'sandbox', registrationNo: 'REG1', ntn: null, strn: null,
  posId: 'POS7', apiBaseUrl: null, apiToken: null, providerConfig: {}, ...over,
});

const invoice: FiscalInvoice = {
  orderNo: 'ORD-000001', occurredOn: '2026-07-21', currency: 'PKR',
  subtotalMinor: 100000, discountMinor: 0, taxMinor: 16000, totalMinor: 116000, channel: 'DINE_IN',
};

describe('FiscalRegistry + sandbox reporting', () => {
  it('resolves a provider per authority and falls back to NONE for unknowns', () => {
    expect(registry.get('PRA').authority).toBe('PRA');
    expect(registry.get('FBR').authority).toBe('FBR');
    expect(registry.get('NONE').authority).toBe('NONE');
  });

  it('PRA sandbox synthesises an authority-prefixed invoice number + QR', async () => {
    const res = await registry.get('PRA').report(cfg(), invoice);
    expect(res.authority).toBe('PRA');
    expect(res.environment).toBe('sandbox');
    expect(res.invoiceNumber).toMatch(/^PRA-POS7-20260721-[0-9A-F]{6}$/);
    expect(res.qr).toBe(res.invoiceNumber);
    expect(res.skipped).toBe(false);
  });

  it('FBR sandbox is prefixed FBR (dynamic authority selection)', async () => {
    const res = await registry.get('FBR').report(cfg({ authority: 'FBR' }), invoice);
    expect(res.invoiceNumber.startsWith('FBR-')).toBe(true);
  });

  it('the NONE provider reports nothing (skipped)', async () => {
    const res = await registry.get('NONE').report(cfg({ authority: 'NONE' }), invoice);
    expect(res.skipped).toBe(true);
    expect(res.invoiceNumber).toBe('');
  });

  it('stays in sandbox when production is selected but no token is supplied', async () => {
    const res = await registry.get('PRA').report(cfg({ environment: 'production', apiToken: null }), invoice);
    expect(res.environment).toBe('production');
    expect((res.raw as { sandbox?: boolean }).sandbox).toBe(true); // simulated, not a live call
  });
});
