import { describe, expect, it } from 'vitest';
import { normalizeScan } from './scan.service';

/**
 * Scanners hand us whatever is printed: a bare document number from a CODE39 slip, an opaque table
 * token, a full URL from a QR sticker, or one of our own `mx://` payloads. Normalisation has to strip
 * the wrapper without ever damaging the code inside it.
 */
describe('normalizeScan', () => {
  it('passes a bare document number straight through', () => {
    expect(normalizeScan('ORD-000012')).toEqual({ code: 'ORD-000012', hint: null });
    expect(normalizeScan('KOT-000031')).toEqual({ code: 'KOT-000031', hint: null });
  });

  it('trims the whitespace a wedge scanner appends', () => {
    expect(normalizeScan('  8964000123456 \n').code).toBe('8964000123456');
  });

  it('unwraps our own table payload and hints at a table', () => {
    expect(normalizeScan('mx://table/AbCd1234xyz')).toEqual({ code: 'AbCd1234xyz', hint: 'TABLE' });
    expect(normalizeScan('TBL:AbCd1234xyz')).toEqual({ code: 'AbCd1234xyz', hint: 'TABLE' });
  });

  it('reads a table token out of a public ordering URL', () => {
    expect(normalizeScan('https://order.karahipoint.pk/t/AbCd1234')).toEqual({ code: 'AbCd1234', hint: 'TABLE' });
    expect(normalizeScan('https://order.karahipoint.pk/menu?table=AbCd1234')).toEqual({ code: 'AbCd1234', hint: 'TABLE' });
  });

  it('does not mangle a document number that starts with a kind-like prefix', () => {
    // "ORD-000012" begins with "ord" — the hyphen means it is the number itself, not "ORD:<rest>".
    expect(normalizeScan('ORD-000012').code).toBe('ORD-000012');
    expect(normalizeScan('RES-000004').code).toBe('RES-000004');
    expect(normalizeScan('DLV-000002').code).toBe('DLV-000002');
  });

  it('hints the kind when an explicit prefix is used', () => {
    expect(normalizeScan('order:ORD-000012')).toEqual({ code: 'ORD-000012', hint: 'ORDER' });
    expect(normalizeScan('reservation:A1B2C3')).toEqual({ code: 'A1B2C3', hint: 'RESERVATION' });
    expect(normalizeScan('sku:COKE-500')).toEqual({ code: 'COKE-500', hint: 'MENU_ITEM' });
  });

  it('returns an empty code for an empty scan rather than throwing', () => {
    expect(normalizeScan('')).toEqual({ code: '', hint: null });
    expect(normalizeScan('   ').code).toBe('');
  });

  it('survives a malformed URL', () => {
    expect(normalizeScan('http://').code).toBe('http://');
  });
});
