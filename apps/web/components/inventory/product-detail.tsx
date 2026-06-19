'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, ImageIcon, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import type { Category, LedgerEntry, Product } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthImage } from '@/components/auth-image';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { MovementDialog } from './movement-dialog';
import { ProductImagesDialog } from './product-images-dialog';
import { fmtDateTime } from './inv-ui';

interface Movement { id: string; type: string; quantity: number; reference: string | null; created_at: string | null }

export function ProductDetail({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const product = useQuery({ queryKey: ['product', id], queryFn: () => apiGet<Product>(`/inventory/products/${id}`) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => apiGet<Category[]>('/inventory/categories') });
  const movements = useQuery({ queryKey: ['movements', id], queryFn: () => apiGet<Movement[]>(`/inventory/products/${id}/movements`) });
  const ledger = useQuery({ queryKey: ['item-ledger', id], queryFn: () => apiGet<LedgerEntry[]>(`/inventory/products/${id}/ledger`) });
  const [moveOpen, setMoveOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [f, setF] = useState({ name: '', unit: '', cost: '', sell: '', minStock: '', categoryId: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    const p = product.data;
    if (p) setF({ name: p.name, unit: p.unit, cost: String(p.costPrice.amountMinor / 100), sell: String(p.sellPrice.amountMinor / 100), minStock: String(p.minStock), categoryId: p.categoryId ?? '' });
  }, [product.data]);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['product', id] }); void qc.invalidateQueries({ queryKey: ['products'] }); };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const save = useMutation({
    mutationFn: () => apiPatch(`/inventory/products/${id}`, { name: f.name, unit: f.unit, costPriceMinor: Math.round(Number(f.cost) * 100), sellPriceMinor: Math.round(Number(f.sell) * 100), minStock: Number(f.minStock) || 0, categoryId: f.categoryId || undefined }),
    onSuccess: () => { toast.success('Product saved'); invalidate(); }, onError: onErr,
  });
  const remove = useMutation({ mutationFn: () => apiDelete(`/inventory/products/${id}`), onSuccess: () => { toast.success('Product deleted'); invalidate(); onDeleted?.(); }, onError: onErr });

  if (product.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (product.isError || !product.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Product not found.</div>;
  const p = product.data;
  const low = p.onHand < p.minStock;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{p.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
          {low ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">LOW</span> : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => setImagesOpen(true)}><ImageIcon className="mr-1.5 h-4 w-4" /> Images</Button>
        <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}><ArrowLeftRight className="mr-1.5 h-4 w-4" /> Move</Button>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this product? (only if it holds no stock)')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="flex gap-4">
          {p.primaryImageId ? <AuthImage path={`/inventory/products/${id}/images/${p.primaryImageId}`} alt={p.name} className="h-24 w-24 shrink-0 rounded-xl border object-cover" /> : null}
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="On hand" value={`${p.onHand} ${p.unit}`} tone={low ? 'amber' : 'default'} />
            <Tile label="Cost (WAVG)" value={formatMoney(p.costPrice.amountMinor, p.costPrice.currency)} />
            <Tile label="Sell" value={formatMoney(p.sellPrice.amountMinor, p.sellPrice.currency)} />
            <Tile label="Stock value" value={formatMoney(p.onHand * p.costPrice.amountMinor, p.costPrice.currency)} />
          </div>
        </div>

        <section className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="Unit"><Input value={f.unit} onChange={set('unit')} /></Field>
          <Field label="Min stock"><Input value={f.minStock} onChange={set('minStock')} type="number" min={0} /></Field>
          <Field label="Cost price"><Input value={f.cost} onChange={set('cost')} type="number" min={0} step="0.01" /></Field>
          <Field label="Sell price"><Input value={f.sell} onChange={set('sell')} type="number" min={0} step="0.01" /></Field>
          <Field label="Category" className="col-span-2">
            <select value={f.categoryId} onChange={set('categoryId')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Uncategorised</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{'— '.repeat(Math.max(0, c.level - 1))}{c.name}</option>)}
            </select>
          </Field>
          <div className="col-span-2"><Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent movements</h3>
            <div className="space-y-1.5">
              {(movements.data ?? []).slice(0, 8).map((mv) => (
                <div key={mv.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span className={`font-medium ${mv.type === 'IN' ? 'text-emerald-600' : mv.type === 'OUT' ? 'text-rose-600' : 'text-sky-600'}`}>{mv.type} {mv.quantity}</span>
                  <span className="truncate px-2 text-xs text-muted-foreground">{mv.reference ?? ''}</span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(mv.created_at)}</span>
                </div>
              ))}
              {(movements.data ?? []).length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">No movements.</p> : null}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valued ledger</h3>
            <div className="space-y-1.5">
              {(ledger.data ?? []).slice(0, 8).map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{l.docNo ?? l.docType}</span>
                  <span className="text-xs">{l.qtyIn > 0 ? `+${l.qtyIn}` : `-${l.qtyOut}`} → {l.balanceQty}</span>
                  <span className="text-xs text-muted-foreground">{formatMoney(l.balanceValue.amountMinor, l.balanceValue.currency)}</span>
                </div>
              ))}
              {(ledger.data ?? []).length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">No ledger entries.</p> : null}
            </div>
          </section>
        </div>
      </PaneBody>

      {moveOpen ? <MovementDialog product={p} onClose={() => { setMoveOpen(false); invalidate(); void qc.invalidateQueries({ queryKey: ['movements', id] }); }} /> : null}
      <ProductImagesDialog productId={imagesOpen ? id : null} productName={p.name} open={imagesOpen} onOpenChange={(v) => { setImagesOpen(v); if (!v) invalidate(); }} />
    </>
  );
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${tone === 'amber' ? 'text-amber-600' : ''}`}>{value}</p></div>;
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
