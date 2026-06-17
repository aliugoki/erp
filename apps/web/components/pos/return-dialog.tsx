'use client';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import type { PosSale } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** Refund all or part of a completed sale — pick a quantity per line to return. */
export function ReturnDialog({
  open,
  onOpenChange,
  sale,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sale: PosSale | null;
  onDone: (returnSale: PosSale) => void;
}) {
  const currency = sale?.total.currency ?? 'PKR';
  const [qty, setQty] = useState<Record<string, number>>({});

  useEffect(() => {
    if (sale) {
      const init: Record<string, number> = {};
      for (const l of sale.lines ?? []) init[l.id!] = Math.max(0, l.quantity - (l.returnedQty ?? 0));
      setQty(init);
    }
  }, [sale]);

  const refundMut = useMutation({
    mutationFn: () => {
      const lines = Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([lineId, quantity]) => ({ lineId, quantity }));
      return apiPost<PosSale>(`/pos/sales/${sale!.id}/refund`, { lines, method: 'CASH' });
    },
    onSuccess: (ret) => {
      toast.success(`Refunded ${ret.saleNo}`);
      onDone(ret);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Refund failed'),
  });

  if (!sale) return null;
  const anyQty = Object.values(qty).some((q) => q > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund {sale.saleNo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {(sale.lines ?? []).map((l) => {
            const max = l.quantity - (l.returnedQty ?? 0);
            return (
              <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{l.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(l.unitPrice.amountMinor, currency)} · {max} refundable
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={max}
                  value={qty[l.id!] ?? 0}
                  className="w-20"
                  onChange={(e) => setQty((q) => ({ ...q, [l.id!]: Math.min(max, Math.max(0, Number(e.target.value))) }))}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between gap-2 border-t pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!anyQty || refundMut.isPending} onClick={() => refundMut.mutate()}>
            {refundMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
            Refund cash
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
