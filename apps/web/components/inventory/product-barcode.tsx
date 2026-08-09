'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Barcode, Download, Loader2 } from 'lucide-react';
import { ApiError, apiBlob, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { AuthImage } from '@/components/auth-image';

const err = (e: unknown) => (e instanceof ApiError ? e.message : '');

/**
 * A product's barcode on its detail pane: mint one, look at it, download it for a label template.
 * Minted codes are internal EAN-13s in the GS1 in-store range (20–29), drawn from a tenant-wide
 * counter so a product code can never collide with one issued by another module.
 */
export function ProductBarcodePanel({ productId, productName, barcode }: {
  productId: string; productName: string; barcode: string | null;
}) {
  const qc = useQueryClient();

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost(`/inventory/products/${productId}/barcode`, body),
    onSuccess: () => {
      toast.success('Barcode issued', { description: productName });
      qc.invalidateQueries({ queryKey: ['product', productId] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error('Could not issue a barcode', { description: err(e) }),
  });

  const download = async () => {
    if (!barcode) return;
    try {
      const blob = await apiBlob(`/codes/barcode?value=${encodeURIComponent(barcode)}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${barcode}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Could not download the barcode', { description: err(e) });
    }
  };

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Barcode className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Barcode</span>
        {barcode
          ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{barcode}</code>
          : <span className="text-xs text-muted-foreground">not set</span>}
      </div>
      {barcode ? (
        <>
          <AuthImage path={`/codes/barcode?value=${encodeURIComponent(barcode)}`} alt={barcode} className="h-16 w-auto max-w-full bg-white p-1" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={download}><Download className="mr-1.5 size-3.5" /> SVG</Button>
            <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ regenerate: true })}>Regenerate</Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Regenerating invalidates labels already printed.</p>
        </>
      ) : (
        <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({})}>
          {act.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Barcode className="mr-1.5 size-3.5" />} Generate barcode
        </Button>
      )}
    </section>
  );
}

/**
 * Bulk-mint for every product without a barcode — the realistic path after importing a supplier
 * catalogue. Hidden once everything is coded, so the toolbar doesn't carry a dead control.
 */
export function GenerateMissingProductBarcodes({ missing }: { missing: number }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => apiPost<{ issued: number }>('/inventory/products/barcodes/generate-missing', {}),
    onSuccess: (res) => {
      toast.success(
        res.issued === 0 ? 'Every product already has a barcode' : `${res.issued} barcode${res.issued === 1 ? '' : 's'} issued`,
        { description: res.issued > 0 ? 'Internal EAN-13, unique across the whole business.' : undefined },
      );
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
    onError: (e) => toast.error('Could not generate barcodes', { description: err(e) }),
  });

  if (missing <= 0) return null;
  return (
    <Button size="sm" variant="ghost" disabled={run.isPending}
      title={`Mint an internal EAN-13 for the ${missing} product${missing === 1 ? '' : 's'} without one`}
      onClick={() => run.mutate()}>
      {run.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Barcode className="mr-1.5 size-3.5" />}
      {missing} barcode{missing === 1 ? '' : 's'}
    </Button>
  );
}
