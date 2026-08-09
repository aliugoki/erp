'use client';
import { useState } from 'react';
import { Barcode, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { AuthImage } from '@/components/auth-image';
import { Hint } from '@/components/restaurant/rest-ui';

/** One label on the sheet. `code` is what gets encoded; the rest is human-readable context. */
export interface LabelRow {
  id: string;
  code: string | null;
  name: string;
  sub?: string | null;
  price?: string | null;
}

/** Labels per row on an A4 page — 2 for wide shelf-edge strips, 4 for small product stickers. */
const COLUMNS = [
  { value: '2', label: '2 per row (large)' },
  { value: '3', label: '3 per row' },
  { value: '4', label: '4 per row (small)' },
];

/**
 * Print many product barcodes at once, on ordinary sticker sheets through an ordinary printer — which
 * is how most businesses actually label a catalogue. (A thermal label printer is the other path: it
 * prints one label at a time through the print spool.)
 *
 * Every barcode is rendered server-side as SVG so it prints at the printer's own resolution; a
 * rasterised barcode scaled to fit a page is the classic reason labels won't scan.
 */
export function BarcodeSheetDialog({
  rows,
  title = 'Print barcodes',
  triggerLabel = 'Print barcodes',
  emptyHint = 'Nothing to print — generate barcodes first.',
}: {
  rows: LabelRow[];
  title?: string;
  triggerLabel?: string;
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState('3');
  const [copies, setCopies] = useState('1');

  const printable = rows.filter((r) => r.code);
  // Repeating a row is how you get a strip of identical stickers for one product.
  const cells = printable.flatMap((r) => Array.from({ length: Math.max(1, Number(copies)) }, (_, i) => ({ ...r, key: `${r.id}-${i}` })));
  const gridCols = cols === '2' ? 'grid-cols-2' : cols === '4' ? 'grid-cols-4' : 'grid-cols-3';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Barcode className="mr-1.5 size-3.5" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {printable.length} label{printable.length === 1 ? '' : 's'} ready
            {rows.length !== printable.length ? ` · ${rows.length - printable.length} without a barcode (skipped)` : ''}
            . Print onto sticker sheets and cut along the cards.
          </DialogDescription>
        </DialogHeader>

        {printable.length === 0 ? <Hint>{emptyHint}</Hint> : (
          <>
            <div className="flex flex-wrap items-end gap-4 print:hidden">
              <div className="w-44">
                <Label>Labels per row</Label>
                <Select value={cols} onValueChange={setCols}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COLUMNS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="w-36">
                <Label>Copies each</Label>
                <Select value={copies} onValueChange={setCopies}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['1', '2', '3', '4', '6', '8'].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <p className="flex-1 text-xs text-muted-foreground">
                Total {cells.length} sticker{cells.length === 1 ? '' : 's'}.
              </p>
            </div>

            <div id="barcode-sheet" className={`grid gap-2 ${gridCols}`}>
              {cells.map((c) => (
                <div key={c.key} className="flex break-inside-avoid flex-col items-center gap-0.5 rounded border bg-white p-2 text-center">
                  <span className="w-full truncate text-[11px] font-semibold text-black" title={c.name}>{c.name}</span>
                  {c.sub ? <span className="w-full truncate text-[9px] text-neutral-500">{c.sub}</span> : null}
                  <AuthImage
                    path={`/codes/barcode?value=${encodeURIComponent(c.code!)}&height=44&moduleWidth=2`}
                    alt={c.code!}
                    className="h-12 w-auto max-w-full"
                  />
                  {c.price ? <span className="text-[11px] font-bold text-black">{c.price}</span> : null}
                </div>
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button onClick={() => window.print()} disabled={printable.length === 0}>
            <Printer className="mr-2 size-4" /> Print sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
