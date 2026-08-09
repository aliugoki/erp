import { describe, expect, it } from 'vitest';
import { type ReceiptDoc, pad, renderEscPos, renderEscPosBase64, renderText, row, wrap } from './escpos.util';
import { buildBillDoc, buildKotDoc, buildLabelDoc, buildTestDoc, fmtAmount, fmtClock, fmtWhen } from './receipt.builder';
import { reachabilityError } from './printer.service';

const bytes = (doc: ReceiptDoc) => Array.from(renderEscPos(doc));
/** Does the byte stream contain this exact command sequence? */
const hasSeq = (arr: number[], seq: number[]) =>
  arr.some((_, i) => seq.every((s, j) => arr[i + j] === s));

describe('escpos text layout', () => {
  it('wraps on whitespace within the paper width', () => {
    expect(wrap('Chicken Karahi with extra spice', 12)).toEqual(['Chicken', 'Karahi with', 'extra spice']);
  });

  it('hard-splits a word longer than the line so no text is lost', () => {
    expect(wrap('SUPERCALIFRAGILISTIC', 8)).toEqual(['SUPERCAL', 'IFRAGILI', 'STIC']);
  });

  it('pads to the requested alignment', () => {
    expect(pad('ab', 6, 'left')).toBe('ab    ');
    expect(pad('ab', 6, 'right')).toBe('    ab');
    expect(pad('ab', 6, 'center')).toBe('  ab  ');
  });

  it('lays a row out with the value flush right', () => {
    expect(row('Subtotal', '1,810.00', 24)).toBe('Subtotal        1,810.00');
    expect(row('Subtotal', '1,810.00', 24).length).toBe(24);
  });

  it('clips the label rather than the amount when a row overflows', () => {
    const r = row('An extremely long dish name indeed', '9,999.00', 20);
    expect(r).toContain('9,999.00');
    expect(r.length).toBe(20);
  });

  it('indents a row (modifier lines sit under their dish)', () => {
    expect(row('+ Extra hot', '50.00', 24, 4)).toBe('    + Extra hot    50.00');
  });
});

describe('escpos byte rendering', () => {
  const doc: ReceiptDoc = {
    charsPerLine: 32,
    blocks: [
      { t: 'text', value: 'KARAHI POINT', align: 'center', bold: true, size: 'WIDE' },
      { t: 'row', left: 'Total', right: '100.00', bold: true },
      { t: 'rule' },
      { t: 'qr', value: 'https://pra.example/inv/1' },
      { t: 'barcode', value: 'ORD-000012', symbology: 'CODE39' },
      { t: 'drawer' },
      { t: 'cut' },
    ],
  };

  it('always initialises the printer first (clears state a previous job left)', () => {
    expect(bytes(doc).slice(0, 2)).toEqual([0x1b, 0x40]);
  });

  it('emits centre alignment and resets it after the block', () => {
    const b = bytes(doc);
    expect(hasSeq(b, [0x1b, 0x61, 0x01])).toBe(true); // ESC a 1 — centre
    expect(hasSeq(b, [0x1b, 0x61, 0x00])).toBe(true); // ESC a 0 — back to left
  });

  it('turns emphasis and double-width on and back off', () => {
    const b = bytes(doc);
    expect(hasSeq(b, [0x1b, 0x45, 0x01])).toBe(true);
    expect(hasSeq(b, [0x1b, 0x45, 0x00])).toBe(true);
    expect(hasSeq(b, [0x1d, 0x21, 0x10])).toBe(true); // GS ! double width
    expect(hasSeq(b, [0x1d, 0x21, 0x00])).toBe(true);
  });

  it('emits the QR store + print sequence', () => {
    const b = bytes(doc);
    expect(hasSeq(b, [0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32])).toBe(true); // model 2
    expect(hasSeq(b, [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])).toBe(true); // print
  });

  it('emits a CODE39 barcode with human-readable text below', () => {
    const b = bytes(doc);
    expect(hasSeq(b, [0x1d, 0x48, 0x02])).toBe(true); // HRI below
    expect(hasSeq(b, [0x1d, 0x6b, 0x45])).toBe(true); // GS k 69 = CODE39
  });

  it('kicks the drawer and cuts only after feeding past the blade', () => {
    const b = bytes(doc);
    expect(hasSeq(b, [0x1b, 0x70, 0x00])).toBe(true);
    expect(hasSeq(b, [0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00])).toBe(true);
  });

  it('replaces glyphs a CP437 head cannot print instead of emitting garbage', () => {
    const b = bytes({ charsPerLine: 32, blocks: [{ t: 'text', value: 'Café 🍽 مینو' }] });
    expect(b.every((n) => n >= 0 && n <= 255)).toBe(true);
    expect(b).toContain(0x3f); // '?'
  });

  it('base64-encodes the same stream', () => {
    expect(Buffer.from(renderEscPosBase64(doc), 'base64')).toEqual(Buffer.from(renderEscPos(doc)));
  });
});

describe('money + time formatting', () => {
  it('formats minor units with thousands separators', () => {
    expect(fmtAmount(181000, 'PKR')).toBe('1,810.00');
    expect(fmtAmount(5, 'PKR')).toBe('0.05');
    expect(fmtAmount(-2500, 'PKR')).toBe('-25.00');
  });

  it('respects zero-decimal currencies', () => {
    expect(fmtAmount(1810, 'JPY')).toBe('1,810');
  });

  it('stamps wall-clock time in the branch timezone, not UTC', () => {
    const utcMidnight = '2026-07-27T19:30:00.000Z';
    expect(fmtClock(utcMidnight, 'Asia/Karachi')).toBe('00:30'); // UTC+5
    expect(fmtWhen(utcMidnight, 'Asia/Karachi')).toContain('28 Jul 2026');
  });

  it('renders an empty stamp for a missing date rather than "Invalid Date"', () => {
    expect(fmtWhen(null)).toBe('');
    expect(fmtClock('not-a-date')).toBe('');
  });
});

describe('bill document', () => {
  const input = {
    charsPerLine: 42,
    timeZone: 'Asia/Karachi',
    brand: { name: 'Karahi Point', branchName: 'Gulberg', phone: '042-111-222', taxNumber: '1234567-8', footer: 'Shukriya!' },
    order: {
      orderNo: 'ORD-000012', channel: 'DINE_IN', table: 'T2', guestCount: 4, waiter: 'Bilal',
      settledAt: '2026-07-27T10:00:00.000Z', currency: 'PKR',
    },
    lines: [
      {
        name: 'Chicken Karahi', qty: 2, unitPriceMinor: 115000, lineTotalMinor: 230000,
        modifiers: [{ name: 'Extra hot', priceDeltaMinor: 5000, qty: 1 }],
      },
      { name: 'Garlic Naan', qty: 3, unitPriceMinor: 12000, lineTotalMinor: 36000 },
    ],
    totals: { subtotalMinor: 266000, discountMinor: 0, serviceChargeMinor: 13300, taxMinor: 42560, totalMinor: 321900, paidMinor: 350000 },
    payments: [{ method: 'CASH', amountMinor: 350000 }],
  };

  it('prints identity, priced lines, modifiers and the tax breakdown', () => {
    const text = renderText(buildBillDoc(input));
    expect(text).toContain('Karahi Point');
    expect(text).toContain('ORD-000012');
    expect(text).toContain('Table T2');
    expect(text).toContain('2 x Chicken Karahi');
    expect(text).toContain('+ Extra hot');
    expect(text).toContain('Service charge');
    expect(text).toContain('Sales tax');
    expect(text).toContain('TOTAL PKR');
    expect(text).toContain('3,219.00');
  });

  it('computes change from the tendered amount', () => {
    expect(renderText(buildBillDoc(input))).toMatch(/Change\s+281\.00/);
  });

  it('omits zero-value total rows so the slip stays short', () => {
    const text = renderText(buildBillDoc(input));
    expect(text).not.toContain('Discount');
    expect(text).not.toContain('Tip');
  });

  it('prints the fiscal QR + invoice number once the authority has accepted it', () => {
    const text = renderText(buildBillDoc({ ...input, fiscal: { authority: 'PRA', invoiceNo: 'PRA-99', qr: 'https://pra/inv/99' } }));
    expect(text).toContain('[QR] https://pra/inv/99');
    expect(text).toContain('PRA Invoice');
    expect(text).toContain('PRA-99');
  });

  it('falls back to a scannable order barcode when not yet fiscalised', () => {
    expect(renderText(buildBillDoc(input))).toContain('|| ORD-000012 ||');
  });

  it('marks a reprint and kicks the drawer only when asked', () => {
    const plain = bytes(buildBillDoc(input));
    expect(hasSeq(plain, [0x1b, 0x70, 0x00])).toBe(false);
    const withDrawer = buildBillDoc({ ...input, cashDrawer: true, copyLabel: 'REPRINT' });
    expect(renderText(withDrawer)).toContain('*** REPRINT ***');
    expect(hasSeq(Array.from(renderEscPos(withDrawer)), [0x1b, 0x70, 0x00])).toBe(true);
  });

  it('adds up on paper: the printed line amounts equal the printed subtotal', () => {
    // A guest checks the slip by adding the right-hand column. Line amounts must therefore be the same
    // basis as Subtotal (gross, tax-exclusive) — tax is shown once, below.
    const lineSum = input.lines.reduce((s, l) => s + l.lineTotalMinor, 0);
    expect(lineSum).toBe(input.totals.subtotalMinor);
    const text = renderText(buildBillDoc(input));
    expect(text).toMatch(/2 x Chicken Karahi\s+2,300\.00/);
    expect(text).toMatch(/Subtotal\s+2,660\.00/);
  });

  it('keeps every line within the paper width', () => {
    for (const line of renderText(buildBillDoc(input)).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(42);
    }
  });
});

describe('kitchen ticket', () => {
  const kot = {
    stationName: 'HOT KITCHEN', ticketNo: 'KOT-000031', orderNo: 'ORD-000012', channel: 'DINE_IN',
    table: 'T2', guestCount: 4, waiter: 'Bilal', priority: 'RUSH', firedAt: '2026-07-27T10:00:00.000Z',
    targetMinutes: 18,
    items: [
      { name: 'Chicken Karahi', qty: 2, modifiers: 'Extra hot, No coriander', notes: 'Guest is allergic to nuts' },
      { name: 'Mutton Kunna', qty: 1, course: 2 },
    ],
  };

  it('shows quantity, dish, modifiers and notes — and never a price', () => {
    const text = renderText(buildKotDoc(kot));
    expect(text).toContain('HOT KITCHEN');
    expect(text).toContain('KOT-000031');
    expect(text).toContain('2 x Chicken Karahi');
    expect(text).toContain('Extra hot, No coriander');
    expect(text).toContain('** Guest is allergic to nuts');
    expect(text).toContain('(course 2)');
    expect(text).not.toMatch(/\d+\.\d{2}/);
  });

  it('calls out priority and reprint so a duplicate is never mistaken for a new order', () => {
    expect(renderText(buildKotDoc(kot))).toContain('!! RUSH !!');
    expect(renderText(buildKotDoc({ ...kot, isReprint: true }))).toContain('*** REPRINT ***');
    expect(renderText(buildKotDoc({ ...kot, priority: 'NORMAL' }))).not.toContain('!!');
  });

  it('prints the station name in double size and the dishes in double height', () => {
    const b = bytes(buildKotDoc(kot));
    expect(hasSeq(b, [0x1d, 0x21, 0x11])).toBe(true); // LARGE (2x2) station banner
    expect(hasSeq(b, [0x1d, 0x21, 0x01])).toBe(true); // TALL dish lines
  });

  it('fires at branch-local time', () => {
    expect(renderText(buildKotDoc(kot))).toContain('15:00'); // 10:00 UTC = 15:00 PKT
  });
});

describe('test page', () => {
  it('proves the configured paper width', () => {
    const text = renderText(buildTestDoc('Till 1', 32, new Date('2026-07-27T10:00:00.000Z')));
    expect(text).toContain('PRINTER TEST');
    expect(text).toContain('Till 1');
    expect(text).toContain('32 chars');
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(32);
  });
});

describe('printer reachability', () => {
  it('demands a host for a network printer', () => {
    expect(reachabilityError('NETWORK', null, null)).toMatch(/needs a host/);
    expect(reachabilityError('NETWORK', '192.168.1.50', null)).toBeNull();
  });

  it('demands a device path for USB and Bluetooth', () => {
    expect(reachabilityError('USB', null, null)).toMatch(/device path/);
    expect(reachabilityError('BLUETOOTH', null, null)).toMatch(/device path/);
    expect(reachabilityError('USB', null, '/dev/usb/lp0')).toBeNull();
  });

  it('accepts browser/cloud printers, which carry no address at all', () => {
    expect(reachabilityError('BROWSER', null, null)).toBeNull();
    expect(reachabilityError('CLOUD', null, null)).toBeNull();
  });

  it('keeps the stored address when only the port changes (the merged-update path)', () => {
    // Regression: spreading a class-validator DTO overwrote `host` with its own `undefined`, so
    // changing just the port was rejected as "needs a host".
    const stored = { connection: 'NETWORK', host: '127.0.0.1', devicePath: null };
    const patch: { connection?: string; host?: string; devicePath?: string } = { host: undefined, devicePath: undefined };
    expect(reachabilityError(patch.connection ?? stored.connection, patch.host ?? stored.host, patch.devicePath ?? stored.devicePath)).toBeNull();
  });
});

describe('labels', () => {
  it('puts a QR table tent on paper', () => {
    const doc = buildLabelDoc({ title: 'TABLE T2', qr: 'mx://table/AbCd1234', caption: 'Scan to order' });
    const text = renderText(doc);
    expect(text).toContain('TABLE T2');
    expect(text).toContain('[QR] mx://table/AbCd1234');
    expect(text).toContain('Scan to order');
  });

  it('prints a product barcode as a REAL EAN-13, not CODE39 digits', () => {
    // GS k 67 is the EAN13 command. Emitting CODE39 digits instead produces a label that looks right
    // but fails at any retail scanner, which validates symbology and check digit.
    const b = Array.from(renderEscPos(buildLabelDoc({ title: 'Cola 500ml', barcode: '5449000000996', symbology: 'EAN13' })));
    expect(hasSeq(b, [0x1d, 0x6b, 0x43])).toBe(true);
    expect(hasSeq(b, [0x1d, 0x6b, 0x45])).toBe(false); // not CODE39
  });

  it('still uses CODE39 for document numbers', () => {
    const b = Array.from(renderEscPos(buildLabelDoc({ title: 'Order', barcode: 'ORD-000021', symbology: 'CODE39' })));
    expect(hasSeq(b, [0x1d, 0x6b, 0x45])).toBe(true);
  });

  it('carries the copy count for the agent', () => {
    expect(buildLabelDoc({ title: 'T1', qr: 'x', copies: 3 }).copies).toBe(3);
  });
});
