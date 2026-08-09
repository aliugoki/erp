/**
 * Barcode generation and rendering (pure — no I/O, no dependencies).
 *
 * Two symbologies cover a restaurant completely:
 *  • **EAN-13** for products a scanner meets in the wild (bottled drinks, packaged desserts) and for
 *    the *internal* codes we mint for our own dishes; and
 *  • **CODE39** for document numbers (ORD-000021, KOT-000026) — it is alphanumeric, self-checking and
 *    every cheap laser scanner reads it without configuration.
 *
 * Rendering targets SVG because it prints crisply at any size (a barcode rasterised at the wrong
 * resolution simply will not scan) and embeds directly in a page, a label or a PDF. Thermal printers
 * don't need any of this — they draw barcodes natively from ESC/POS commands (see escpos.util).
 */

export type BarcodeSymbology = 'EAN13' | 'CODE39';

// ── EAN-13 ───────────────────────────────────────────────────────────────────────

/**
 * The 13th digit: each of the first 12 is weighted 1,3,1,3… from the left, and the check digit is
 * whatever rounds that sum up to a multiple of ten. A scanner rejects a code whose check digit
 * doesn't match, so generating this correctly is the difference between a label that works and one
 * that beeps in error at the till.
 */
export function ean13CheckDigit(first12: string): number {
  const digits = String(first12).replace(/\D/g, '').slice(0, 12);
  if (digits.length !== 12) throw new Error('EAN-13 needs exactly 12 digits before the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits.length !== 13) return false;
  return ean13CheckDigit(digits.slice(0, 12)) === Number(digits[12]);
}

/**
 * Mint an internal EAN-13 from a running sequence.
 *
 * GS1 reserves prefixes **20–29 for in-store / restricted circulation**: codes that are only
 * meaningful inside one business. Own-menu items belong there — using a real GS1 prefix we don't own
 * would collide with someone else's product the moment the item leaves the building.
 */
export function generateInternalEan13(sequence: number, prefix = '20'): string {
  const p = String(prefix).replace(/\D/g, '');
  if (!/^2[0-9]$/.test(p)) throw new Error('An internal barcode prefix must be in the GS1 in-store range 20–29');
  const bodyLength = 12 - p.length;
  const seq = Math.max(0, Math.trunc(sequence)) % 10 ** bodyLength;
  const first12 = p + String(seq).padStart(bodyLength, '0');
  return first12 + String(ean13CheckDigit(first12));
}

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = EAN_L.map((s) => [...s].map((b) => (b === '0' ? '1' : '0')).join(''));
/** The first digit isn't drawn as bars — it's encoded in the parity pattern of the left-hand six. */
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** EAN-13 as a module string: '1' = dark module, '0' = light. 95 modules wide. */
export function ean13Modules(code: string): string {
  const digits = String(code).replace(/\D/g, '');
  const full = digits.length === 12 ? digits + String(ean13CheckDigit(digits)) : digits;
  if (!isValidEan13(full)) throw new Error(`"${code}" is not a valid EAN-13`);
  const parity = EAN_PARITY[Number(full[0])]!;
  let out = '101'; // start guard
  for (let i = 0; i < 6; i++) {
    const d = Number(full[i + 1]);
    out += parity[i] === 'L' ? EAN_L[d]! : EAN_G[d]!;
  }
  out += '01010'; // centre guard
  for (let i = 7; i < 13; i++) out += EAN_R[Number(full[i])]!;
  return out + '101'; // end guard
}

// ── CODE39 ───────────────────────────────────────────────────────────────────────

/** Nine elements per character (bar, space, bar…), three of them wide. `*` frames the message. */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

export function code39Supports(value: string): boolean {
  return [...String(value ?? '').toUpperCase()].every((c) => c in CODE39 && c !== '*');
}

/** CODE39 as a module string, wide elements being `wideRatio` narrow modules. */
export function code39Modules(value: string, wideRatio = 3): string {
  const text = String(value ?? '').toUpperCase();
  if (!code39Supports(text)) throw new Error(`"${value}" contains characters CODE39 cannot encode`);
  const chars = ['*', ...text, '*'];
  let out = '';
  chars.forEach((ch, idx) => {
    const widths = CODE39[ch]!;
    for (let i = 0; i < widths.length; i++) {
      const dark = i % 2 === 0; // elements alternate bar, space, bar…
      out += (dark ? '1' : '0').repeat(widths[i] === 'w' ? wideRatio : 1);
    }
    if (idx < chars.length - 1) out += '0'; // narrow inter-character gap
  });
  return out;
}

// ── SVG rendering ────────────────────────────────────────────────────────────────

export interface BarcodeSvgOptions {
  /** Width of one module in px — 2 or more keeps it scannable on paper. */
  moduleWidth?: number;
  height?: number;
  /** Print the human-readable value beneath the bars (required for retail EAN). */
  showText?: boolean;
  /** Quiet zone in modules. EAN needs ≥9; too little and scanners miss the start guard. */
  quietModules?: number;
}

const escapeXml = (s: string) =>
  String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/**
 * Render a barcode as standalone SVG. Runs of dark modules are merged into single `<rect>`s, so the
 * output stays small enough to inline in a page or a label without bloating it.
 */
export function barcodeSvg(value: string, symbology: BarcodeSymbology = 'CODE39', opts: BarcodeSvgOptions = {}): string {
  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 60;
  const showText = opts.showText ?? true;
  const quiet = opts.quietModules ?? (symbology === 'EAN13' ? 9 : 10);
  const modules = symbology === 'EAN13' ? ean13Modules(value) : code39Modules(value);
  const textHeight = showText ? 14 : 0;
  const width = (modules.length + quiet * 2) * moduleWidth;
  const totalHeight = height + textHeight;

  const bars: string[] = [];
  let run = 0;
  for (let i = 0; i <= modules.length; i++) {
    if (modules[i] === '1') {
      run++;
      continue;
    }
    if (run > 0) {
      const x = (quiet + i - run) * moduleWidth;
      bars.push(`<rect x="${x}" y="0" width="${run * moduleWidth}" height="${height}" />`);
      run = 0;
    }
  }
  const label = showText
    ? `<text x="${width / 2}" y="${totalHeight - 2}" text-anchor="middle" font-family="monospace" font-size="12" fill="#000">${escapeXml(String(value).toUpperCase())}</text>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" role="img" aria-label="${escapeXml(String(value))}">`,
    `<rect width="${width}" height="${totalHeight}" fill="#fff" />`,
    `<g fill="#000">${bars.join('')}</g>`,
    label,
    '</svg>',
  ].join('');
}

/**
 * Pick the symbology that actually fits a value: a 12/13-digit numeric string is a real EAN, anything
 * else (a document number like ORD-000021) has to be CODE39.
 */
export function symbologyFor(value: string): BarcodeSymbology {
  const digits = String(value ?? '').replace(/\D/g, '');
  if ((digits.length === 13 && isValidEan13(digits)) || digits.length === 12) {
    if (digits === String(value ?? '')) return 'EAN13';
  }
  return 'CODE39';
}
