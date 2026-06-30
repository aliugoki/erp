import { describe, expect, it, vi } from 'vitest';
import { FbrClient } from '../src/modules/tax/fbr.client';
import { FbrService } from '../src/modules/tax/fbr.service';

describe('FbrClient (sandbox)', () => {
  const client = new FbrClient();

  it('synthesises a deterministic FBR invoice number + QR in sandbox', async () => {
    const res = await client.report({ sellerNtn: '123', sellerName: 'Acme', posId: 'pos-7', environment: 'sandbox' }, { foo: 1 });
    expect(res.fbrInvoiceNumber).toMatch(/^POS-7-\d{8}-[0-9A-F]{6}$/);
    expect(res.qr).toBe(res.fbrInvoiceNumber); // the receipt QR encodes the FBR invoice number
    expect(res.environment).toBe('sandbox');
    expect((res.response as { sandbox?: boolean }).sandbox).toBe(true);
  });

  it('falls back to sandbox for production without credentials (no token → no live call)', async () => {
    const res = await client.report({ sellerNtn: '1', sellerName: 'X', posId: '', environment: 'production', apiToken: null }, {});
    expect(res.fbrInvoiceNumber).toMatch(/^POS-\d{8}-[0-9A-F]{6}$/); // empty posId → default POS prefix
    expect((res.response as { sandbox?: boolean }).sandbox).toBe(true);
  });
});

describe('FbrService.autoReportSaleFor (event-driven gating)', () => {
  const client = { report: vi.fn() } as never;

  it('skips silently when the tenant lacks the tax feature', async () => {
    const features = { isEnabled: vi.fn().mockResolvedValue(false) } as never;
    const tenantTx = { runFor: vi.fn() } as never;
    await new FbrService(tenantTx, client, features).autoReportSaleFor('t1', 's1');
    expect((tenantTx as { runFor: ReturnType<typeof vi.fn> }).runFor).not.toHaveBeenCalled(); // no DB work
    expect((client as { report: ReturnType<typeof vi.fn> }).report).not.toHaveBeenCalled();
  });

  it('skips when FBR is not enabled in config', async () => {
    const features = { isEnabled: vi.fn().mockResolvedValue(true) } as never;
    const manager = { query: vi.fn().mockResolvedValue([{ environment: 'sandbox', enabled: false, api_token: null }]) };
    const tenantTx = { runFor: (_t: string, fn: (m: unknown) => unknown) => Promise.resolve(fn(manager)) } as never;
    await new FbrService(tenantTx, client, features).autoReportSaleFor('t1', 's1');
    expect((client as { report: ReturnType<typeof vi.fn> }).report).not.toHaveBeenCalled(); // config disabled → no report
  });
});
