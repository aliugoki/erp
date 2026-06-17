'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Star, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch, apiUpload } from '@/lib/api';
import type { ProductImage } from '@/lib/types';
import { AuthImage } from '@/components/auth-image';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ProductImagesDialog({
  productId,
  productName,
  open,
  onOpenChange,
}: {
  productId: string | null;
  productName?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const images = useQuery({
    queryKey: ['product-images', productId],
    queryFn: () => apiGet<ProductImage[]>(`/inventory/products/${productId}/images`),
    enabled: !!productId && open,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['product-images', productId] });
    void qc.invalidateQueries({ queryKey: ['products'] });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Action failed');

  async function onPick(files: FileList | null) {
    if (!files || !productId) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', f);
        await apiUpload(`/inventory/products/${productId}/images`, fd);
      }
      toast.success(`Uploaded ${files.length} image${files.length > 1 ? 's' : ''}`);
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const setPrimary = useMutation({ mutationFn: (imageId: string) => apiPatch(`/inventory/products/${productId}/images/${imageId}/primary`), onSuccess: () => { toast.success('Primary image set'); refresh(); }, onError: fail });
  const del = useMutation({ mutationFn: (imageId: string) => apiDelete(`/inventory/products/${productId}/images/${imageId}`), onSuccess: () => { toast.success('Image removed'); refresh(); }, onError: fail });

  const list = images.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Images — {productName ?? 'Product'}</DialogTitle>
          <DialogDescription>Upload one or more images; mark one as the primary thumbnail.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onPick(e.target.files)} />
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Upload images
            </Button>
          </div>

          {images.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No images yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {list.map((img) => (
                <div key={img.id} className="group relative overflow-hidden rounded-lg border">
                  <AuthImage path={`/inventory/products/${productId}/images/${img.id}`} alt="" className="aspect-square w-full" />
                  {img.isPrimary ? (
                    <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                      <Star className="h-3 w-3" /> Primary
                    </span>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                    {!img.isPrimary ? (
                      <Button size="icon" variant="secondary" className="h-7 w-7" title="Set primary" onClick={() => setPrimary.mutate(img.id)}>
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    <Button size="icon" variant="destructive" className="h-7 w-7" title="Delete" onClick={() => del.mutate(img.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
