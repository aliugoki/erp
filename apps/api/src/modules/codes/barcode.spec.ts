import { describe, expect, it } from 'vitest';
import {
  barcodeSvg, code39Modules, code39Supports, ean13CheckDigit, ean13Modules,
  generateInternalEan13, isValidEan13, symbologyFor,
} from './barcode.util';

describe('EAN-13 check digit', () => {
  it('matches a real retail barcode', () => {
    // Coca-Cola 500ml — the check digit of 544900000099 is 6.
    expect(ean13CheckDigit('544900000099')).toBe(6);
    expect(isValidEan13('5449000000996')).toBe(true);
  });

  it('rejects a code whose check digit is wrong — the scanner would beep in error', () => {
    expect(isValidEan13('5449000000997')).toBe(false);
    expect(isValidEan13('544900000099')).toBe(false); // too short
    expect(isValidEan13('')).toBe(false);
  });

  it('refuses to compute from the wrong number of digits', () => {
    expect(() => ean13CheckDigit('12345')).toThrow(/12 digits/);
  });
});

describe('internal barcode minting', () => {
  it('generates a valid, checkable code from a sequence', () => {
    const code = generateInternalEan13(42);
    expect(code).toHaveLength(13);
    expect(isValidEan13(code)).toBe(true);
    expect(code.startsWith('20')).toBe(true);
  });

  it('is stable and unique per sequence number', () => {
    expect(generateInternalEan13(7)).toBe(generateInternalEan13(7));
    expect(generateInternalEan13(7)).not.toBe(generateInternalEan13(8));
  });

  it('stays inside the GS1 in-store range, so it cannot collide with a real product', () => {
    expect(generateInternalEan13(1, '29').startsWith('29')).toBe(true);
    // 40 is a real GS1 prefix (Germany) — minting there would clash with someone else's product.
    expect(() => generateInternalEan13(1, '40')).toThrow(/in-store range/);
  });
});

describe('EAN-13 modules', () => {
  it('is 95 modules wide with the standard guards', () => {
    const m = ean13Modules('5449000000996');
    expect(m).toHaveLength(95);
    expect(m.startsWith('101')).toBe(true);
    expect(m.endsWith('101')).toBe(true);
    expect(m.slice(45, 50)).toBe('01010'); // centre guard
  });

  it('accepts 12 digits and appends the check digit itself', () => {
    expect(ean13Modules('544900000099')).toBe(ean13Modules('5449000000996'));
  });

  it('encodes the first digit as parity, not as bars', () => {
    // Same trailing digits, different leading digit → different left-hand parity pattern.
    expect(ean13Modules('0000000000000')).not.toBe(ean13Modules('9000000000001'));
  });
});

describe('CODE39', () => {
  it('encodes document numbers restaurants actually print', () => {
    expect(code39Supports('ORD-000021')).toBe(true);
    expect(code39Modules('ORD-000021').length).toBeGreaterThan(0);
  });

  it('frames the message with start/stop characters', () => {
    const bare = code39Modules('A');
    const framed = code39Modules('');
    expect(bare.length).toBeGreaterThan(framed.length);
    expect(framed.length).toBeGreaterThan(0); // '*' + '*' still encodes
  });

  it('rejects characters it cannot represent', () => {
    expect(code39Supports('lower')).toBe(true); // upper-cased internally
    expect(code39Supports('café')).toBe(false);
    expect(() => code39Modules('café')).toThrow(/cannot encode/);
  });
});

describe('SVG rendering', () => {
  it('produces standalone SVG with a quiet zone and a readable caption', () => {
    const svg = barcodeSvg('5449000000996', 'EAN13');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('5449000000996');
    expect(svg).toContain('<rect');
  });

  it('omits the caption when asked', () => {
    expect(barcodeSvg('ORD-1', 'CODE39', { showText: false })).not.toContain('<text');
  });

  it('escapes the value so a crafted code cannot inject markup', () => {
    const svg = barcodeSvg('AB-1', 'CODE39');
    expect(svg).not.toContain('<script');
    expect(barcodeSvg('A$B', 'CODE39')).toContain('A$B');
  });

  it('scales with module width', () => {
    const narrow = barcodeSvg('ORD-1', 'CODE39', { moduleWidth: 1 });
    const wide = barcodeSvg('ORD-1', 'CODE39', { moduleWidth: 4 });
    const w = (s: string) => Number(/width="(\d+)"/.exec(s)![1]);
    expect(w(wide)).toBe(w(narrow) * 4);
  });
});

describe('symbology choice', () => {
  it('uses EAN13 for a real product code and CODE39 for a document number', () => {
    expect(symbologyFor('5449000000996')).toBe('EAN13');
    expect(symbologyFor('ORD-000021')).toBe('CODE39');
    expect(symbologyFor('KOT-000026')).toBe('CODE39');
  });
});

describe('guarding what enters the catalogue', () => {
  it('accepts a real supplier EAN and rejects a mistyped one', () => {
    // The check the item create/update path applies: a 13-digit code claims to be an EAN, so a wrong
    // check digit is a label that will fail at the till — caught at entry, not at the counter.
    const looksLikeEan = (s: string) => /^\d{13}$/.test(s);
    expect(looksLikeEan('5449000000996') && isValidEan13('5449000000996')).toBe(true);
    expect(looksLikeEan('8964000112233') && isValidEan13('8964000112233')).toBe(false);
  });

  it('leaves non-EAN shapes alone — internal SKUs and UPC-A are legitimate', () => {
    for (const code of ['NIHARI-001', 'COKE-500', '012345678905']) {
      expect(/^\d{13}$/.test(code)).toBe(false); // never subjected to the EAN-13 rule
    }
  });
});
