import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';

/** A rendered report: its columns (with labels + money flag) and plain row objects keyed by column key. */
export interface RenderColumn {
  key: string;
  label: string;
  money?: boolean;
}
export interface RenderableReport {
  title: string;
  columns: RenderColumn[];
  rows: Array<Record<string, unknown>>;
}

export type ReportFormat = 'csv' | 'xlsx' | 'pdf';

export const FORMAT_META: Record<ReportFormat, { type: string; ext: string }> = {
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pdf: { type: 'application/pdf', ext: 'pdf' },
};

/** Money columns hold integer minor units — present as major with 2 decimals. */
function cell(col: RenderColumn, row: Record<string, unknown>): string {
  const v = row[col.key];
  if (v === null || v === undefined) return '';
  if (col.money && (typeof v === 'number' || /^-?\d+$/.test(String(v)))) {
    return (Number(v) / 100).toFixed(2);
  }
  return String(v);
}

// ── CSV ────────────────────────────────────────────────────────────────────────
function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rep: RenderableReport): Buffer {
  const head = rep.columns.map((c) => csvField(c.label)).join(',');
  const body = rep.rows.map((r) => rep.columns.map((c) => csvField(cell(c, r))).join(',')).join('\n');
  return Buffer.from(`${head}\n${body}\n`, 'utf-8');
}

// ── XLSX ───────────────────────────────────────────────────────────────────────
export async function toXlsx(rep: RenderableReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MetaXperts ERP';
  const ws = wb.addWorksheet(rep.title.slice(0, 31) || 'Report');
  ws.columns = rep.columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(40, Math.max(12, c.label.length + 2)) }));
  ws.getRow(1).font = { bold: true };
  for (const r of rep.rows) {
    ws.addRow(
      Object.fromEntries(
        rep.columns.map((c) => [c.key, c.money && r[c.key] != null ? Number(r[c.key]) / 100 : (r[c.key] ?? '')]),
      ),
    );
  }
  for (const c of rep.columns) if (c.money) ws.getColumn(c.key).numFmt = '#,##0.00';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ────────────────────────────────────────────────────────────────────────
/** Helvetica (WinAnsi) can't encode arbitrary unicode — fold the common ERP glyphs and drop the rest. */
function ascii(s: string): string {
  return s
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/₨/g, 'Rs')
    .replace(/[^\x20-\x7E]/g, '');
}
export async function toPdf(rep: RenderableReport): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 36; // A4 landscape
  const colW = (W - 2 * M) / Math.max(1, rep.columns.length);
  const rowH = 16, fs = 8;
  let page!: import('pdf-lib').PDFPage;
  let y = 0;

  const newPage = () => {
    page = doc.addPage([W, H]);
    page.drawText(ascii(rep.title), { x: M, y: H - M, size: 13, font: bold, color: rgb(0.1, 0.1, 0.12) });
    y = H - M - 22;
    rep.columns.forEach((c, i) =>
      page.drawText(ascii(c.label).slice(0, Math.floor(colW / (fs * 0.5))), { x: M + i * colW + 2, y, size: fs, font: bold }),
    );
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    y -= rowH;
  };
  newPage();

  for (const r of rep.rows) {
    if (y < M) newPage();
    rep.columns.forEach((c, i) => {
      const txt = ascii(cell(c, r)).slice(0, Math.floor(colW / (fs * 0.5)));
      page.drawText(txt, { x: M + i * colW + 2, y, size: fs, font, color: rgb(0.15, 0.15, 0.15) });
    });
    y -= rowH;
  }
  // footer: row count
  page.drawText(ascii(`${rep.rows.length} rows`), { x: M, y: M - 14, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
  return Buffer.from(await doc.save());
}

export async function renderReport(format: ReportFormat, rep: RenderableReport): Promise<Buffer> {
  if (format === 'csv') return toCsv(rep);
  if (format === 'xlsx') return toXlsx(rep);
  return toPdf(rep);
}
