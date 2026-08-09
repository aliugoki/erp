'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Utensils } from 'lucide-react';
import { ApiError, apiDelete, apiPut } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { type InventoryProduct, type Recipe, Spinner, recipeCostMinor } from '@/components/restaurant/rest-ui';

const err = (e: unknown) => (e instanceof ApiError ? e.message : '');

/**
 * Recipe (bill of materials) for a menu item. Ingredients reference the shared inventory ledger, so
 * settlement deducts stock and captures real COGS. Quantities are in each ingredient's base stock unit
 * (g / ml / piece) — whole numbers, because the ledger tracks integer units.
 */
export function RecipeCard({ itemId, recipe, loading, products }: {
  itemId: string; recipe?: Recipe; loading: boolean; products: InventoryProduct[];
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => apiDelete(`/restaurant/items/${itemId}/recipe`),
    onSuccess: () => { toast.success('Recipe removed'); qc.invalidateQueries({ queryKey: ['rest-recipe', itemId] }); },
    onError: (e) => toast.error('Could not remove', { description: err(e) }),
  });

  if (loading) return <div className="mt-6 max-w-md"><h3 className="mb-2 text-sm font-semibold">Recipe</h3><Spinner /></div>;

  return (
    <div className="mt-6 max-w-md">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recipe &amp; COGS</h3>
        <div className="flex gap-2">
          <RecipeEditor itemId={itemId} recipe={recipe} products={products} />
          {recipe ? <Button size="sm" variant="destructive" disabled={del.isPending} onClick={() => del.mutate()}><Trash2 className="size-3.5" /></Button> : null}
        </div>
      </div>
      {!recipe ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          No recipe. Add ingredients so settlement deducts stock and captures COGS.
        </p>
      ) : recipe.ingredients.length === 0 ? (
        <p className="text-xs text-muted-foreground">Recipe has no ingredients.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
                <tr><th className="px-3 py-1.5 font-medium">Ingredient</th><th className="px-3 py-1.5 text-right font-medium">Qty</th><th className="px-3 py-1.5 text-right font-medium">Cost</th></tr>
              </thead>
              <tbody className="divide-y">
                {recipe.ingredients.map((i) => {
                  const consumed = Math.round((i.qtyPerYieldMilli / Math.max(1, recipe.yieldQty)) * (1 + i.wasteBp / 10000));
                  return (
                    <tr key={i.id}>
                      <td className="px-3 py-1.5">{i.name}{i.wasteBp > 0 ? <span className="ml-1 text-[10px] text-amber-600">+{(i.wasteBp / 100).toFixed(0)}% waste</span> : null}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{consumed}{i.unit ? ` ${i.unit}` : ''}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(consumed * i.unitCost.amountMinor, i.unitCost.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Est. COGS / serving (yield {recipe.yieldQty})</span>
            <span className="font-bold tabular-nums">{formatMoney(recipeCostMinor(recipe), recipe.ingredients[0]?.unitCost.currency ?? 'PKR')}</span>
          </div>
        </>
      )}
    </div>
  );
}

interface Row { productId: string; qty: string; wasteBp: string }

function RecipeEditor({ itemId, recipe, products }: { itemId: string; recipe?: Recipe; products: InventoryProduct[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [yieldQty, setYieldQty] = useState('1');
  const [rows, setRows] = useState<Row[]>([{ productId: '', qty: '', wasteBp: '0' }]);

  const load = () => {
    setYieldQty(String(recipe?.yieldQty ?? 1));
    setRows(recipe && recipe.ingredients.length
      ? recipe.ingredients.map((i) => ({ productId: i.productId, qty: String(i.qtyPerYieldMilli), wasteBp: String(i.wasteBp / 100) }))
      : [{ productId: '', qty: '', wasteBp: '0' }]);
  };

  const save = useMutation({
    mutationFn: () => apiPut(`/restaurant/items/${itemId}/recipe`, {
      yieldQty: Number(yieldQty) || 1,
      ingredients: rows.filter((r) => r.productId && Number(r.qty) > 0).map((r) => ({
        productId: r.productId,
        qtyPerYieldMilli: Math.round(Number(r.qty)),
        wasteBp: Math.round(Number(r.wasteBp || '0') * 100),
      })),
    }),
    onSuccess: () => { toast.success('Recipe saved'); qc.invalidateQueries({ queryKey: ['rest-recipe', itemId] }); setOpen(false); },
    onError: (e) => toast.error('Could not save recipe', { description: err(e) }),
  });

  const setRow = (idx: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { productId: '', qty: '', wasteBp: '0' }]);
  const rmRow = (idx: number) => setRows((rs) => rs.filter((_, i) => i !== idx));
  const valid = rows.some((r) => r.productId && Number(r.qty) > 0);

  function onSubmit(e: FormEvent) { e.preventDefault(); save.mutate(); }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Utensils className="size-3.5" /> {recipe ? 'Edit recipe' : 'Add recipe'}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{recipe ? 'Edit' : 'Add'} recipe</DialogTitle>
          <DialogDescription>Quantities are in each ingredient&apos;s stock unit (g / ml / piece) per yield.</DialogDescription>
        </DialogHeader>
        {products.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No inventory products yet. Add ingredients in Inventory first.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex items-center gap-3">
              <Label htmlFor="yq" className="shrink-0">Yield (servings)</Label>
              <Input id="yq" type="number" min="1" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} className="h-9 w-24" />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_70px_64px_28px] items-center gap-2 text-[11px] font-medium text-muted-foreground">
                <span>Ingredient</span><span className="text-right">Qty</span><span className="text-right">Waste%</span><span />
              </div>
              {rows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_70px_64px_28px] items-center gap-2">
                  <Select value={r.productId} onValueChange={(v) => setRow(idx, { productId: v })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Pick ingredient" /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.unit ? ` (${p.unit})` : ''}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min="0" value={r.qty} onChange={(e) => setRow(idx, { qty: e.target.value })} className="h-9 text-right" placeholder="0" />
                  <Input type="number" min="0" value={r.wasteBp} onChange={(e) => setRow(idx, { wasteBp: e.target.value })} className="h-9 text-right" />
                  <button type="button" onClick={() => rmRow(idx)} className="text-muted-foreground hover:text-rose-600" title="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" onClick={addRow}><Plus className="size-3.5" /> Add ingredient</Button>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? 'Saving…' : 'Save recipe'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
