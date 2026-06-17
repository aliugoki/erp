'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import type { EcDiscount } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Coupon codes shoppers can apply at checkout. */
export function DiscountsAdmin() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['ec-discounts'], queryFn: () => apiGet<EcDiscount[]>('/ecommerce/discounts') });
  const [code, setCode] = useState('');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('10');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ec-discounts'] });

  const create = useMutation({
    mutationFn: () => apiPost('/ecommerce/discounts', {
      code, type, value: type === 'FIXED' ? Math.round(Number(value) * 100) : Number(value),
    }),
    onSuccess: () => { setCode(''); toast.success('Discount created'); void invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/ecommerce/discounts/${id}`),
    onSuccess: () => { toast.success('Removed'); void invalidate(); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Code</span>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SAVE10" className="w-36" />
        </label>
        <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'FIXED')} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="PERCENT">Percent %</option>
            <option value="FIXED">Fixed amount</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{type === 'PERCENT' ? 'Percent' : 'Amount'}</span>
          <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="w-28" />
        </label>
        <Button onClick={() => create.mutate()} disabled={!code || create.isPending}>
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Add
        </Button>
      </div>
      <div className="rounded-xl border divide-y">
        {(list.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No discount codes.</p>
        ) : (
          list.data!.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <code className="rounded bg-muted px-2 py-1 text-sm font-semibold">{d.code}</code>
                <span className="text-sm text-muted-foreground">{d.type === 'PERCENT' ? `${d.value}% off` : `${(d.value / 100).toFixed(2)} off`}</span>
                {d.usedCount > 0 ? <Badge variant="secondary" className="text-[10px]">{d.usedCount} used</Badge> : null}
                {!d.active ? <Badge variant="outline" className="text-[10px]">inactive</Badge> : null}
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(d.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
