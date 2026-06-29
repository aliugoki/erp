import { describe, expect, it } from 'vitest';
import { FbrClient } from '../src/modules/tax/fbr.client';

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
