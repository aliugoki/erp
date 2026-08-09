import type { Block, ReceiptDoc, Symbology } from './escpos.util';

/**
 * Document builders — the *layout* of a restaurant's paper (pure functions, no DB, no device).
 *
 * Two documents matter operationally:
 *  • the **bill** the guest gets at the till (branding, priced lines, tax breakdown, payments, the
 *    fiscal QR the tax authority requires, a scannable order barcode so a reprint/dispute can be
 *    pulled up by scanning the slip); and
 *  • the **KOT** the kitchen gets when an order fires (no prices — a cook needs quantity, dish,
 *    modifiers and notes in large type, and the station name big enough to read across a hot line).
 *
 * Both return a device-free {@link ReceiptDoc} that escpos.util renders to bytes or to text.
 */

/** Minor-unit exponent by ISO-4217 code — PKR/USD/AED are 2, JPY/KRW are 0. Default 2. */
const CURRENCY_EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, PKR: 2, USD: 2, AED: 2, SAR: 2, GBP: 2, EUR: 2 };

/** Format integer minor units for paper: grouped thousands, currency's own decimal places. */
export function fmtAmount(amountMinor: number, currency = 'PKR'): string {
  const exp = CURRENCY_EXPONENT[currency.toUpperCase()] ?? 2;
  const neg = amountMinor < 0;
  const abs = Math.abs(Math.trunc(amountMinor));
  const div = 10 ** exp;
  const whole = Math.floor(abs / div);
  const frac = abs % div;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = exp === 0 ? grouped : `${grouped}.${String(frac).padStart(exp, '0')}`;
  return neg ? `-${body}` : body;
}

/**
 * Wall-clock stamp in the branch's timezone (`Asia/Karachi` by default) — a receipt printed in Lahore
 * must never show UTC. Falls back to the raw ISO string if the runtime rejects the timezone.
 */
export function fmtWhen(iso: string | Date | null | undefined, timeZone = 'Asia/Karachi'): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(d);
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
}

/** Clock only (HH:MM) — KOTs care about *when it fired*, not the date. */
export function fmtClock(iso: string | Date | null | undefined, timeZone = 'Asia/Karachi'): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

export interface BillBrand {
  name: string;
  branchName?: string | null;
  address?: string | null;
  phone?: string | null;
  taxNumber?: string | null;
  header?: string | null;
  footer?: string | null;
}

export interface BillLine {
  name: string;
  qty: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  discountMinor?: number;
  modifiers?: Array<{ name: string; priceDeltaMinor?: number; qty?: number }>;
  notes?: string | null;
}

export interface BillDocInput {
  charsPerLine?: number;
  timeZone?: string;
  brand: BillBrand;
  order: {
    orderNo: string;
    channel: string;
    status?: string;
    table?: string | null;
    guestCount?: number;
    waiter?: string | null;
    customer?: string | null;
    placedAt?: string | Date | null;
    settledAt?: string | Date | null;
    currency: string;
  };
  lines: BillLine[];
  totals: {
    subtotalMinor: number;
    discountMinor?: number;
    serviceChargeMinor?: number;
    taxMinor?: number;
    tipMinor?: number;
    roundingMinor?: number;
    totalMinor: number;
    paidMinor?: number;
  };
  payments?: Array<{ method: string; amountMinor: number; tipMinor?: number; reference?: string | null }>;
  /** Stamped by the fiscal consumer (PRA/FBR). Absent until the authority accepts the invoice. */
  fiscal?: { authority?: string | null; invoiceNo?: string | null; qr?: string | null } | null;
  showQr?: boolean;
  /** Ribbon across the top: 'REPRINT', 'GUEST COPY', 'PRO-FORMA — NOT A TAX INVOICE'. */
  copyLabel?: string | null;
  cashDrawer?: boolean;
  cut?: boolean;
}

/**
 * The guest bill. Layout follows what Pakistani diners expect on an 80mm slip: brand block, the
 * order's identity, priced lines with modifiers indented beneath, the tax/service breakdown, how it
 * was paid (with change), then the fiscal block — QR plus invoice number — and a footer.
 */
export function buildBillDoc(input: BillDocInput): ReceiptDoc {
  const cur = input.order.currency || 'PKR';
  const tz = input.timeZone ?? 'Asia/Karachi';
  const money = (v: number) => fmtAmount(v, cur);
  const b: Block[] = [];

  if (input.copyLabel) {
    b.push({ t: 'text', value: `*** ${input.copyLabel} ***`, align: 'center', bold: true });
  }
  b.push({ t: 'text', value: input.brand.name, align: 'center', bold: true, size: 'WIDE' });
  if (input.brand.branchName) b.push({ t: 'text', value: input.brand.branchName, align: 'center' });
  if (input.brand.address) b.push({ t: 'text', value: input.brand.address, align: 'center' });
  if (input.brand.phone) b.push({ t: 'text', value: `Tel: ${input.brand.phone}`, align: 'center' });
  if (input.brand.taxNumber) b.push({ t: 'text', value: `NTN/STRN: ${input.brand.taxNumber}`, align: 'center' });
  if (input.brand.header) b.push({ t: 'text', value: input.brand.header, align: 'center' });

  b.push({ t: 'rule' });
  b.push({ t: 'row', left: 'Bill', right: input.order.orderNo, bold: true });
  b.push({ t: 'row', left: 'Date', right: fmtWhen(input.order.settledAt ?? input.order.placedAt ?? new Date(), tz) });
  const where = input.order.table ? `${input.order.channel} · Table ${input.order.table}` : input.order.channel;
  b.push({ t: 'row', left: 'Type', right: where });
  if (input.order.guestCount && input.order.guestCount > 0) b.push({ t: 'row', left: 'Guests', right: String(input.order.guestCount) });
  if (input.order.waiter) b.push({ t: 'row', left: 'Served by', right: input.order.waiter });
  if (input.order.customer) b.push({ t: 'row', left: 'Customer', right: input.order.customer });
  b.push({ t: 'rule' });

  for (const l of input.lines) {
    b.push({ t: 'row', left: `${l.qty} x ${l.name}`, right: money(l.lineTotalMinor) });
    if (l.qty > 1) b.push({ t: 'row', left: `@ ${money(l.unitPriceMinor)}`, right: '', indent: 4 });
    for (const mod of l.modifiers ?? []) {
      const delta = mod.priceDeltaMinor ?? 0;
      b.push({ t: 'row', left: `+ ${mod.name}`, right: delta ? money(delta * (mod.qty ?? 1)) : '', indent: 4 });
    }
    if (l.discountMinor) b.push({ t: 'row', left: 'Discount', right: `-${money(l.discountMinor)}`, indent: 4 });
    if (l.notes) b.push({ t: 'text', value: `    * ${l.notes}` });
  }

  b.push({ t: 'rule' });
  const t = input.totals;
  b.push({ t: 'row', left: 'Subtotal', right: money(t.subtotalMinor) });
  if (t.discountMinor) b.push({ t: 'row', left: 'Discount', right: `-${money(t.discountMinor)}` });
  if (t.serviceChargeMinor) b.push({ t: 'row', left: 'Service charge', right: money(t.serviceChargeMinor) });
  if (t.taxMinor) b.push({ t: 'row', left: 'Sales tax', right: money(t.taxMinor) });
  if (t.tipMinor) b.push({ t: 'row', left: 'Tip', right: money(t.tipMinor) });
  if (t.roundingMinor) b.push({ t: 'row', left: 'Rounding', right: money(t.roundingMinor) });
  b.push({ t: 'rule', char: '=' });
  b.push({ t: 'row', left: `TOTAL ${cur}`, right: money(t.totalMinor), bold: true });
  b.push({ t: 'rule', char: '=' });

  const payments = input.payments ?? [];
  if (payments.length) {
    for (const p of payments) {
      const label = p.reference ? `${p.method} ${p.reference}` : p.method;
      b.push({ t: 'row', left: label, right: money(p.amountMinor) });
    }
    const paid = t.paidMinor ?? payments.reduce((s, p) => s + p.amountMinor, 0);
    const change = paid - t.totalMinor;
    if (change > 0) b.push({ t: 'row', left: 'Change', right: money(change), bold: true });
  }

  if (input.fiscal?.invoiceNo || input.fiscal?.qr) {
    b.push({ t: 'rule' });
    if (input.fiscal.qr) b.push({ t: 'qr', value: input.fiscal.qr, size: 6 });
    if (input.fiscal.invoiceNo) {
      b.push({ t: 'text', value: `${input.fiscal.authority ?? 'FISCAL'} Invoice`, align: 'center' });
      b.push({ t: 'text', value: input.fiscal.invoiceNo, align: 'center', bold: true });
    }
  } else if (input.showQr !== false) {
    // No fiscal number yet — still give the slip a machine-readable identity so a waiter can scan it
    // back into the POS to reprint, settle or resolve a dispute.
    b.push({ t: 'rule' });
    b.push({ t: 'barcode', value: input.order.orderNo, symbology: 'CODE39', height: 50 });
  }

  b.push({ t: 'text', value: input.brand.footer?.trim() || 'Thank you — please come again!', align: 'center' });
  b.push({ t: 'feed', lines: 1 });
  if (input.cashDrawer) b.push({ t: 'drawer' });
  if (input.cut !== false) b.push({ t: 'cut' });

  return { charsPerLine: input.charsPerLine ?? 42, blocks: b };
}

export interface KotDocInput {
  charsPerLine?: number;
  timeZone?: string;
  stationName: string;
  ticketNo: string;
  orderNo: string;
  channel: string;
  table?: string | null;
  guestCount?: number;
  waiter?: string | null;
  priority?: string | null;
  firedAt?: string | Date | null;
  targetMinutes?: number | null;
  items: Array<{ name: string; qty: number; modifiers?: string | null; notes?: string | null; course?: number | null }>;
  isReprint?: boolean;
  cut?: boolean;
}

/**
 * The kitchen ticket. Deliberately price-free and large: station name in double size, quantities
 * doubled up front, modifiers and kitchen notes indented under their dish. A RUSH priority or a
 * reprint is called out at the top so the line never confuses a duplicate for a new order.
 */
export function buildKotDoc(input: KotDocInput): ReceiptDoc {
  const tz = input.timeZone ?? 'Asia/Karachi';
  const b: Block[] = [];

  if (input.isReprint) b.push({ t: 'text', value: '*** REPRINT ***', align: 'center', bold: true });
  if (input.priority && input.priority !== 'NORMAL') {
    b.push({ t: 'text', value: `!! ${input.priority} !!`, align: 'center', bold: true, size: 'WIDE' });
  }
  b.push({ t: 'text', value: input.stationName, align: 'center', bold: true, size: 'LARGE' });
  b.push({ t: 'rule', char: '=' });
  b.push({ t: 'row', left: input.ticketNo, right: fmtClock(input.firedAt ?? new Date(), tz), bold: true });
  b.push({ t: 'row', left: 'Order', right: input.orderNo });
  b.push({ t: 'row', left: 'Type', right: input.table ? `${input.channel} · T-${input.table}` : input.channel });
  if (input.guestCount && input.guestCount > 0) b.push({ t: 'row', left: 'Covers', right: String(input.guestCount) });
  if (input.waiter) b.push({ t: 'row', left: 'Waiter', right: input.waiter });
  if (input.targetMinutes) b.push({ t: 'row', left: 'Target', right: `${input.targetMinutes} min` });
  b.push({ t: 'rule', char: '=' });

  for (const it of input.items) {
    b.push({ t: 'text', value: `${it.qty} x ${it.name}`, bold: true, size: 'TALL' });
    if (it.modifiers) b.push({ t: 'text', value: `   ${it.modifiers}` });
    if (it.notes) b.push({ t: 'text', value: `   ** ${it.notes}` });
    if (it.course && it.course > 1) b.push({ t: 'text', value: `   (course ${it.course})` });
  }

  b.push({ t: 'rule' });
  b.push({ t: 'feed', lines: 1 });
  if (input.cut !== false) b.push({ t: 'cut' });

  return { charsPerLine: input.charsPerLine ?? 42, blocks: b };
}

/** A one-off page that proves a printer is reachable and correctly sized (the "Test print" button). */
export function buildTestDoc(printerName: string, charsPerLine = 42, at: Date = new Date(), timeZone = 'Asia/Karachi'): ReceiptDoc {
  return {
    charsPerLine,
    blocks: [
      { t: 'text', value: 'PRINTER TEST', align: 'center', bold: true, size: 'WIDE' },
      { t: 'text', value: printerName, align: 'center' },
      { t: 'rule' },
      { t: 'row', left: 'Width', right: `${charsPerLine} chars` },
      { t: 'row', left: 'Printed', right: fmtWhen(at, timeZone) },
      { t: 'text', value: '1234567890'.repeat(6).slice(0, charsPerLine) },
      { t: 'text', value: 'The quick brown fox jumps over the lazy dog.' },
      { t: 'rule' },
      { t: 'barcode', value: 'TEST-PRINT', symbology: 'CODE39', height: 50 },
      { t: 'text', value: 'If you can read this, the printer is configured.', align: 'center' },
      { t: 'feed', lines: 1 },
      { t: 'cut' },
    ],
  };
}

export interface LabelDocInput {
  charsPerLine?: number;
  /** Big line at the top — a table code, a dish name. */
  title: string;
  /** QR payload (table stickers, menu links). Rendered natively by the printer. */
  qr?: string | null;
  /** 1-D barcode value (product/shelf labels). */
  barcode?: string | null;
  symbology?: Symbology;
  caption?: string | null;
  copies?: number;
  cut?: boolean;
}

/**
 * A small label: title, the code itself, and a caption. Used for table QR tents and product/shelf
 * barcodes. The code is emitted as an ESC/POS QR or barcode command, so the printer draws it at its
 * own native resolution — far more reliable than sending a rasterised image, which scans poorly when
 * the paper width and the image DPI disagree.
 */
export function buildLabelDoc(input: LabelDocInput): ReceiptDoc {
  const b: Block[] = [
    { t: 'text', value: input.title, align: 'center', bold: true, size: 'WIDE' },
    { t: 'feed', lines: 1 },
  ];
  if (input.qr) b.push({ t: 'qr', value: input.qr, size: 8 });
  if (input.barcode) b.push({ t: 'barcode', value: input.barcode, symbology: input.symbology ?? 'CODE39', height: 60 });
  if (input.caption) b.push({ t: 'text', value: input.caption, align: 'center' });
  b.push({ t: 'feed', lines: 1 });
  if (input.cut !== false) b.push({ t: 'cut' });
  return { charsPerLine: input.charsPerLine ?? 42, blocks: b, copies: input.copies };
}
