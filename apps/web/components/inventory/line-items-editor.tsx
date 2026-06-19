'use client';
import { Plus, Trash2 } from 'lucide-react';
import type { Product } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface DocLine { productId: string; qty: string; unitPrice?: string }

/** Editable product-line list shared by the inventory document create forms (requisition, PO, GRN,
 * issue, MRN). Optionally shows a unit-price column (for POs). */
export function LineItemsEditor({ products, lines, onChange, withPrice = false }: { products: Product[]; lines: DocLine[]; onChange: (lines: DocLine[]) => void; withPrice?: boolean }) {
  const set = (i: number, patch: Partial<DocLine>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const add = () => onChange([...lines, { productId: products[0]?.id ?? '', qty: '1', ...(withPrice ? { unitPrice: '' } : {}) }]);
  const remove = (i: number) => onChange(lines.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <select value={l.productId} onChange={(e) => set(i, { productId: e.target.value })} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm">
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
          </select>
          <Input value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} type="number" min={1} className="h-9 w-20" placeholder="Qty" />
          {withPrice ? <Input value={l.unitPrice ?? ''} onChange={(e) => set(i, { unitPrice: e.target.value })} type="number" min={0} step="0.01" className="h-9 w-24" placeholder="Price" /> : null}
          <Button variant="ghost" size="icon" onClick={() => remove(i)} title="Remove"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}><Plus className="mr-1.5 h-4 w-4" /> Add line</Button>
    </div>
  );
}

/** Map editor lines to API payload items, dropping incomplete rows. */
export function toItems(lines: DocLine[], withPrice = false): Array<{ productId: string; qty: number; unitPriceMinor?: number }> {
  return lines
    .filter((l) => l.productId && Number(l.qty) > 0)
    .map((l) => ({ productId: l.productId, qty: Number(l.qty), ...(withPrice && l.unitPrice ? { unitPriceMinor: Math.round(Number(l.unitPrice) * 100) } : {}) }));
}
