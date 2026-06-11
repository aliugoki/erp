'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function MovementDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [qty, setQty] = useState('1');

  const move = useMutation({
    mutationFn: () => apiPost('/inventory/movements', { productId: product!.id, type, quantity: Number(qty) }),
    onSuccess: () => {
      toast.success(`Stock ${type === 'IN' ? 'received' : 'issued'}`, { description: `${qty} × ${product!.name}` });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
      setQty('1');
    },
    onError: (e) => toast.error('Movement failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <Dialog open={Boolean(product)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Stock movement</DialogTitle>
          <DialogDescription>{product?.name} · on hand {product?.onHand}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['IN', 'OUT'] as const).map((t) => {
              const Icon = t === 'IN' ? ArrowDownToLine : ArrowUpFromLine;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-all',
                    type === t ? 'border-primary bg-primary/10 text-primary shadow-glow' : 'hover:bg-accent',
                  )}
                >
                  <Icon className="size-4" /> {t === 'IN' ? 'Receive' : 'Issue'}
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            <Label htmlFor="q">Quantity</Label>
            <Input id="q" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => move.mutate()} disabled={move.isPending}>{move.isPending ? 'Saving…' : 'Apply'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
