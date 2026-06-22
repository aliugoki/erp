'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Loader2, Tags } from 'lucide-react';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TierDto {
  minQty: number;
  unitPriceMinor: number;
}
interface TierRow {
  minQty: string;
  priceMajor: string;
}

/** Quantity-break price-tier editor — embedded in the drug detail form. */
export function PriceTiersCard({ productId, currency }: { productId: string; currency: string }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<TierRow[]>([]);

  const tiers = useQuery({
    queryKey: ['pharm-tiers', productId],
    queryFn: () => apiGet<TierDto[]>(`/pharmacy/products/${productId}/price-tiers`),
  });

  useEffect(() => {
    if (tiers.data) setRows(tiers.data.map((t) => ({ minQty: String(t.minQty), priceMajor: String(t.unitPriceMinor / 100) })));
  }, [tiers.data]);

  const setRow = (i: number, patch: Partial<TierRow>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const save = useMutation({
    mutationFn: () => {
      const payload: TierDto[] = rows
        .filter((r) => Number(r.minQty) >= 1)
        .map((r) => ({ minQty: Number(r.minQty), unitPriceMinor: Math.round(Number(r.priceMajor) * 100) }));
      return apiPut(`/pharmacy/products/${productId}/price-tiers`, { tiers: payload });
    },
    onSuccess: () => {
      toast.success('Price tiers saved');
      qc.invalidateQueries({ queryKey: ['pharm-tiers', productId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="mt-6 rounded-xl border p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Tags className="h-4 w-4 text-muted-foreground" /> Quantity-break pricing
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Bulk orders auto-use the lowest qualifying tier when no price is set on a line.</p>
      {tiers.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={row.minQty} onChange={(e) => setRow(i, { minQty: e.target.value })} type="number" min={1} placeholder="min qty" className="h-9 w-32" />
              <Input value={row.priceMajor} onChange={(e) => setRow(i, { priceMajor: e.target.value })} type="number" min={0} placeholder={`price (${currency})`} className="h-9 w-40" />
              <Button size="icon" variant="ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, { minQty: '', priceMajor: '' }])}><Plus className="mr-2 h-4 w-4" /> Add tier</Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
