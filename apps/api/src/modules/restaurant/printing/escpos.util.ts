/**
 * ESC/POS document model + renderers (pure — no I/O, no device, fully unit-testable).
 *
 * A print job stores a {@link ReceiptDoc}: an ordered list of layout blocks with no device knowledge.
 * Two renderers consume it — {@link renderText} for on-screen preview / browser printing / an audit
 * copy, and {@link renderEscPos} for the byte stream a thermal head actually understands. Keeping the
 * document device-free means the same stored job prints correctly on a 58mm and an 80mm head (only
 * `charsPerLine` changes) and can be re-rendered later without touching the order it came from.
 *
 * ESC/POS is the de-facto command set of every cheap thermal printer (Epson TM-T88, Xprinter, Rongta,
 * Black Copper — the ones actually sitting on tills in Pakistan). Commands used here are the common
 * subset those clones all implement; nothing vendor-specific.
 */

export type Align = 'left' | 'center' | 'right';
/** NORMAL = 1×1, WIDE = double width, TALL = double height, LARGE = 2×2 (station names on a KOT). */
export type TextSize = 'NORMAL' | 'WIDE' | 'TALL' | 'LARGE';
export type Symbology = 'CODE39' | 'CODE128' | 'EAN13';

export type Block =
  | { t: 'text'; value: string; align?: Align; bold?: boolean; size?: TextSize; underline?: boolean }
  /** Two-column line: label flush left, value flush right, dot-free gap between (money rows). */
  | { t: 'row'; left: string; right: string; bold?: boolean; indent?: number }
  /** Full-width rule; `char` defaults to a dash (the classic dotted tear-line). */
  | { t: 'rule'; char?: string }
  | { t: 'feed'; lines?: number }
  | { t: 'qr'; value: string; size?: number }
  | { t: 'barcode'; value: string; symbology?: Symbology; height?: number }
  | { t: 'cut' }
  | { t: 'drawer' };

export interface ReceiptDoc {
  /** Printable columns at Font A: 32 for 58mm paper, 42 (sometimes 48) for 80mm. */
  charsPerLine: number;
  blocks: Block[];
  /** Advisory: how many copies the agent should push (kitchen duplicates, merchant + guest copy). */
  copies?: number;
}

// ── ESC/POS control bytes ────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const ALIGN_CODE: Record<Align, number> = { left: 0, center: 1, right: 2 };
/** GS ! n — high nibble = width multiplier, low nibble = height multiplier (0-based). */
const SIZE_CODE: Record<TextSize, number> = { NORMAL: 0x00, WIDE: 0x10, TALL: 0x01, LARGE: 0x11 };

/**
 * Wrap a string to the printable width, breaking on whitespace and hard-splitting words that are
 * longer than a line (a 30-character dish name must not silently lose its tail).
 */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (paragraph === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/** Pad `s` into `width` columns at the given alignment (truncating an over-long string). */
export function pad(s: string, width: number, align: Align = 'left'): string {
  const v = s.length > width ? s.slice(0, width) : s;
  const gap = width - v.length;
  if (align === 'right') return ' '.repeat(gap) + v;
  if (align === 'center') return ' '.repeat(Math.floor(gap / 2)) + v + ' '.repeat(Math.ceil(gap / 2));
  return v + ' '.repeat(gap);
}

/**
 * Lay out a label/value row. The value (a price) is never truncated — it wins the space and the label
 * is clipped instead, because a bill that prints "Chicken Kara" beside the right number is readable
 * while a truncated number is a dispute.
 */
export function row(left: string, right: string, width: number, indent = 0): string {
  const pre = ' '.repeat(Math.max(0, indent));
  const r = right.length > width ? right.slice(0, width) : right;
  const room = Math.max(0, width - r.length - pre.length);
  const l = left.length > room ? left.slice(0, Math.max(0, room - 1)) : left;
  return pre + l + ' '.repeat(Math.max(0, room - l.length)) + r;
}

/** Widths are halved for double-width text so wrapping still respects the paper. */
const effectiveWidth = (width: number, size?: TextSize) =>
  size === 'WIDE' || size === 'LARGE' ? Math.floor(width / 2) : width;

/**
 * Render the document as plain monospace text — used for the on-screen preview, the browser-print
 * fallback (no ESC/POS device), and the human-readable copy stored with the job.
 */
export function renderText(doc: ReceiptDoc): string {
  const width = Math.max(16, doc.charsPerLine);
  const lines: string[] = [];
  for (const b of doc.blocks) {
    switch (b.t) {
      case 'text': {
        const w = effectiveWidth(width, b.size);
        for (const l of wrap(b.value, w)) lines.push(pad(l, w, b.align ?? 'left').trimEnd());
        break;
      }
      case 'row':
        lines.push(row(b.left, b.right, width, b.indent ?? 0).trimEnd());
        break;
      case 'rule':
        lines.push((b.char ?? '-').repeat(width));
        break;
      case 'feed':
        for (let i = 0; i < (b.lines ?? 1); i++) lines.push('');
        break;
      case 'qr':
        lines.push(pad(`[QR] ${b.value}`, width, 'center').trimEnd());
        break;
      case 'barcode':
        lines.push(pad(`|| ${b.value} ||`, width, 'center').trimEnd());
        break;
      case 'cut':
        lines.push('-'.repeat(width));
        break;
      case 'drawer':
        break;
    }
  }
  return `${lines.join('\n')}\n`;
}

/** ASCII-encode, dropping anything a CP437 thermal head cannot render (emoji, Urdu glyphs). */
function ascii(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out.push(c >= 0x20 && c <= 0x7e ? c : 0x3f); // '?'
  }
  return out;
}

/** QR: GS ( k — model 2, module size, error-correction M, store data, then print. */
function qrBytes(value: string, size = 6): number[] {
  const data = ascii(value);
  const len = data.length + 3;
  return [
    GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // model 2
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.max(1, Math.min(16, size)), // module size
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31, // error correction M
    GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...data, // store
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, // print
  ];
}

/**
 * 1-D barcode: GS h (height), GS w (module width), GS H (HRI below), GS k (print, length-prefixed).
 *
 * EAN13 is emitted as a real EAN (GS k 67), not as CODE39 digits — a shelf label that merely *looks*
 * like a product barcode is useless at a retail scanner, which validates the check digit and the
 * symbology. Non-digits are stripped for EAN because the printer rejects the whole command otherwise.
 */
function barcodeBytes(value: string, symbology: Symbology, height = 60): number[] {
  const text = symbology === 'EAN13' ? value.replace(/\D/g, '').slice(0, 13) : value;
  const data = ascii(symbology === 'CODE39' ? text.toUpperCase() : text);
  // GS k m: 67 = JAN13/EAN13, 69 = CODE39, 73 = CODE128
  const type = symbology === 'EAN13' ? 0x43 : symbology === 'CODE39' ? 0x45 : 0x49;
  const payload = symbology === 'CODE128' ? [0x7b, 0x42, ...data] : data; // CODE128 code-set B prefix
  return [
    GS, 0x68, Math.max(1, Math.min(255, height)),
    GS, 0x77, 0x02,
    GS, 0x48, 0x02, // human-readable text below the bars
    GS, 0x6b, type, payload.length, ...payload,
  ];
}

/**
 * Render the document as an ESC/POS byte stream. Text alignment/emphasis/size are set per block and
 * reset immediately after, so a malformed document can never leave the printer stuck in double-height.
 */
export function renderEscPos(doc: ReceiptDoc): Uint8Array {
  const width = Math.max(16, doc.charsPerLine);
  const out: number[] = [ESC, 0x40]; // ESC @ — initialise (clears any state a previous job left)
  const put = (s: string) => out.push(...ascii(s), LF);

  for (const b of doc.blocks) {
    switch (b.t) {
      case 'text': {
        const size = SIZE_CODE[b.size ?? 'NORMAL'];
        out.push(ESC, 0x61, ALIGN_CODE[b.align ?? 'left']);
        if (size) out.push(GS, 0x21, size);
        if (b.bold) out.push(ESC, 0x45, 0x01);
        if (b.underline) out.push(ESC, 0x2d, 0x01);
        for (const l of wrap(b.value, effectiveWidth(width, b.size))) put(l);
        if (b.underline) out.push(ESC, 0x2d, 0x00);
        if (b.bold) out.push(ESC, 0x45, 0x00);
        if (size) out.push(GS, 0x21, 0x00);
        out.push(ESC, 0x61, 0x00);
        break;
      }
      case 'row':
        if (b.bold) out.push(ESC, 0x45, 0x01);
        put(row(b.left, b.right, width, b.indent ?? 0));
        if (b.bold) out.push(ESC, 0x45, 0x00);
        break;
      case 'rule':
        put((b.char ?? '-').repeat(width));
        break;
      case 'feed':
        for (let i = 0; i < (b.lines ?? 1); i++) out.push(LF);
        break;
      case 'qr':
        out.push(ESC, 0x61, 0x01, ...qrBytes(b.value, b.size), LF, ESC, 0x61, 0x00);
        break;
      case 'barcode':
        out.push(ESC, 0x61, 0x01, ...barcodeBytes(b.value, b.symbology ?? 'CODE128', b.height), LF, ESC, 0x61, 0x00);
        break;
      case 'cut':
        // Feed the cut distance first, else the blade slices through the last printed line.
        out.push(LF, LF, LF, GS, 0x56, 0x42, 0x00); // GS V B 0 — partial cut after feed
        break;
      case 'drawer':
        out.push(ESC, 0x70, 0x00, 0x19, 0xfa); // ESC p 0 — kick drawer pin 2
        break;
    }
  }
  return Uint8Array.from(out);
}

/** ESC/POS bytes as base64 — how a job travels over the JSON API to the print agent. */
export function renderEscPosBase64(doc: ReceiptDoc): string {
  return Buffer.from(renderEscPos(doc)).toString('base64');
}
