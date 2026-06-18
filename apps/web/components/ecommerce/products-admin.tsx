'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Layers, Loader2, Pencil, Plus, ShoppingBag, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '@/lib/api';
import type { EcCollection, EcProduct, EcProductImage, EcVariant, Product } from '@/lib/types';
import { AuthImage } from '@/components/auth-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { formatMoney } from '@/lib/utils';

const toMinor = (s: string): number | undefined => (s === '' ? undefined : Math.round((Number(s) || 0) * 100));

export function ProductsAdmin() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['ec-products'], queryFn: () => apiGet<EcProduct[]>('/ecommerce/products') });
  const [editing, setEditing] = useState<EcProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [imagesFor, setImagesFor] = useState<EcProduct | null>(null);
  const [variantsFor, setVariantsFor] = useState<EcProduct | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ec-products'] });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/ecommerce/products/${id}`),
    onSuccess: () => { toast.success('Product removed'); void invalidate(); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" /> List a product</Button>
      </div>
      {list.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (list.data ?? []).length === 0 ? (
        <p className="rounded-xl border py-16 text-center text-sm text-muted-foreground">No products listed yet. Click “List a product” to add one from inventory.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data!.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border">
              <div className="flex aspect-[16/10] items-center justify-center bg-muted/40">
                {p.primaryImageId ? (
                  <AuthImage path={`/ecommerce/product-images/${p.primaryImageId}`} alt={p.title} className="h-full w-full object-cover" />
                ) : <ShoppingBag className="h-8 w-8 text-muted-foreground" />}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium">
                      {p.isFeatured ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> : null}
                      <span className="truncate">{p.title}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{p.sku} · {p.onHand ?? 0} in stock</p>
                  </div>
                  <Badge variant={p.status === 'ACTIVE' ? 'default' : p.status === 'DRAFT' ? 'secondary' : 'outline'} className="text-[10px]">{p.status}</Badge>
                </div>
                <p className="mt-2 font-semibold">{formatMoney(p.price.amountMinor, p.price.currency)}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => setImagesFor(p)}><ImagePlus className="mr-1 h-3.5 w-3.5" /> Images{p.imageCount ? ` (${p.imageCount})` : ''}</Button>
                  <Button size="sm" variant="outline" onClick={() => setVariantsFor(p)}><Layers className="mr-1 h-3.5 w-3.5" /> Variants</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(p.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating ? <ProductDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void invalidate(); }} /> : null}
      {editing ? <ProductDialog product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void invalidate(); }} /> : null}
      {imagesFor ? <ImagesDialog product={imagesFor} onClose={() => { setImagesFor(null); void invalidate(); }} /> : null}
      {variantsFor ? <VariantsDialog product={variantsFor} onClose={() => { setVariantsFor(null); void invalidate(); }} /> : null}
    </div>
  );
}

function VariantsDialog({ product, onClose }: { product: EcProduct; onClose: () => void }) {
  const qc = useQueryClient();
  const variants = useQuery({ queryKey: ['ec-variants', product.id], queryFn: () => apiGet<EcVariant[]>(`/ecommerce/products/${product.id}/variants`) });
  const inventory = useQuery({ queryKey: ['inv-products-min'], queryFn: () => apiGet<Product[]>('/inventory/products') });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ec-variants', product.id] });
  const [inv, setInv] = useState('');
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');

  const add = useMutation({
    mutationFn: () => apiPost(`/ecommerce/products/${product.id}/variants`, {
      inventoryProductId: inv, label: label || undefined, priceMinor: price ? Math.round(Number(price) * 100) : undefined,
      isDefault: (variants.data ?? []).length === 0,
    }),
    onSuccess: () => { setInv(''); setLabel(''); setPrice(''); toast.success('Variant added'); void invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const setDefault = useMutation({ mutationFn: (id: string) => apiPatch(`/ecommerce/variants/${id}`, { isDefault: true }), onSuccess: () => { toast.success('Default set'); void invalidate(); } });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/ecommerce/variants/${id}`), onSuccess: () => { toast.success('Removed'); void invalidate(); } });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Variants · {product.title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Each variant is backed by its own inventory SKU, so stock and cost stay accurate per option.</p>
        <div className="rounded-lg border divide-y">
          {(variants.data ?? []).length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No variants — this product sells as a single item.</p>
          ) : (
            variants.data!.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  {v.isDefault ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> : null}
                  <span className="font-medium">{v.label}</span>
                  <code className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{v.sku}</code>
                  <span className="text-xs text-muted-foreground">{formatMoney(v.price.amountMinor, v.price.currency)} · {v.onHand ?? 0} in stock</span>
                </div>
                <div className="flex gap-1">
                  {!v.isDefault ? <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(v.id)}>Default</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(v.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Inventory SKU</span>
            <select value={inv} onChange={(e) => setInv(e.target.value)} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="">Select…</option>
              {(inventory.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Label</span><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Large" className="w-28" /></label>
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Price</span><Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="(base)" className="w-24" /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button onClick={() => add.mutate()} disabled={!inv || add.isPending}>{add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Add variant</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ product, onClose, onSaved }: { product?: EcProduct; onClose: () => void; onSaved: () => void }) {
  const editing = !!product;
  const inventory = useQuery({ queryKey: ['inv-products-min'], queryFn: () => apiGet<Product[]>('/inventory/products'), enabled: !editing });
  const collections = useQuery({ queryKey: ['ec-collections'], queryFn: () => apiGet<EcCollection[]>('/ecommerce/collections') });
  const [f, setF] = useState({
    productId: product?.productId ?? '', title: product?.title ?? '', subtitle: product?.subtitle ?? '',
    description: product?.description ?? '', price: product ? String(product.price.amountMinor / 100) : '',
    compareAt: product?.compareAt ? String(product.compareAt.amountMinor / 100) : '', taxRate: String(product?.taxRate ?? 0),
    status: product?.status ?? 'ACTIVE', isFeatured: product?.isFeatured ?? false,
  });
  const [cols, setCols] = useState<string[]>(product?.collectionIds ?? []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: f.title || undefined, subtitle: f.subtitle, description: f.description,
        priceMinor: toMinor(f.price), compareAtMinor: toMinor(f.compareAt), taxRate: Number(f.taxRate) || 0,
        status: f.status, isFeatured: f.isFeatured, collectionIds: cols,
      };
      return editing ? apiPatch(`/ecommerce/products/${product!.id}`, body) : apiPost('/ecommerce/products', { productId: f.productId, ...body });
    },
    onSuccess: () => { toast.success(editing ? 'Product updated' : 'Product listed'); onSaved(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Save failed'),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{editing ? `Edit ${product!.title}` : 'List a product'}</DialogTitle></DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {!editing ? (
            <Field label="Inventory product">
              <select value={f.productId} onChange={set('productId')} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">Select a product…</option>
                {(inventory.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Title"><Input value={f.title} onChange={set('title')} placeholder="(defaults to product name)" /></Field>
          <Field label="Subtitle"><Input value={f.subtitle} onChange={set('subtitle')} /></Field>
          <Field label="Description"><textarea value={f.description} onChange={set('description')} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Price"><Input value={f.price} onChange={set('price')} inputMode="decimal" placeholder="(inventory)" /></Field>
            <Field label="Compare at"><Input value={f.compareAt} onChange={set('compareAt')} inputMode="decimal" /></Field>
            <Field label="Tax %"><Input value={f.taxRate} onChange={set('taxRate')} inputMode="numeric" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={f.status} onChange={set('status')} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm"><Switch checked={f.isFeatured} onCheckedChange={(v) => setF((s) => ({ ...s, isFeatured: v }))} /> Featured</label>
          </div>
          {(collections.data ?? []).length > 0 ? (
            <Field label="Collections">
              <div className="flex flex-wrap gap-2">
                {collections.data!.map((c) => {
                  const on = cols.includes(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => setCols((x) => on ? x.filter((i) => i !== c.id) : [...x, c.id])} className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                      {c.title}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!editing && !f.productId)}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} {editing ? 'Save' : 'List product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImagesDialog({ product, onClose }: { product: EcProduct; onClose: () => void }) {
  const qc = useQueryClient();
  const images = useQuery({ queryKey: ['ec-product-images', product.id], queryFn: () => apiGet<EcProductImage[]>(`/ecommerce/products/${product.id}/images`) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ec-product-images', product.id] });
  const [busy, setBusy] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        await apiUpload(`/ecommerce/products/${product.id}/images`, fd);
      }
      toast.success('Images uploaded');
      void invalidate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  const setPrimary = useMutation({ mutationFn: (imageId: string) => apiPost(`/ecommerce/products/${product.id}/images/${imageId}/primary`, {}), onSuccess: () => { toast.success('Primary set'); void invalidate(); } });
  const remove = useMutation({ mutationFn: (imageId: string) => apiDelete(`/ecommerce/product-images/${imageId}`), onSuccess: () => { toast.success('Removed'); void invalidate(); } });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Images · {product.title}</DialogTitle></DialogHeader>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-sm text-muted-foreground hover:bg-muted/40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Upload images
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          {(images.data ?? []).map((img) => (
            <div key={img.id} className="group relative overflow-hidden rounded-lg border">
              <AuthImage path={`/ecommerce/product-images/${img.id}`} alt="" className="aspect-square w-full object-cover" />
              {img.isPrimary ? <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">Primary</span> : null}
              <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-black/50 p-1 opacity-0 transition group-hover:opacity-100">
                {!img.isPrimary ? <button type="button" onClick={() => setPrimary.mutate(img.id)} className="rounded px-1.5 text-[10px] text-white hover:bg-white/20">Set primary</button> : <span />}
                <button type="button" onClick={() => remove.mutate(img.id)} className="rounded px-1.5 text-[10px] text-white hover:bg-white/20"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
        </div>
        {(images.data ?? []).length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No images yet.</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}
