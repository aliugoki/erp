'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, ShieldCheck, Star, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import type { EcReview } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const tone: Record<string, 'secondary' | 'default' | 'destructive'> = { PENDING: 'secondary', APPROVED: 'default', REJECTED: 'destructive' };

/** Moderate customer reviews — approve to publish, reject to hide, or delete. */
export function ReviewsAdmin() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('PENDING');
  const list = useQuery({ queryKey: ['ec-reviews', filter], queryFn: () => apiGet<EcReview[]>(`/ecommerce/reviews${filter ? `?status=${filter}` : ''}`) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ec-reviews'] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/ecommerce/reviews/${id}/status`, { status }),
    onSuccess: () => { toast.success('Review updated'); void invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/ecommerce/reviews/${id}`), onSuccess: () => { toast.success('Removed'); void invalidate(); } });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="rounded-xl border divide-y">
        {list.isLoading ? (
          <div className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (list.data ?? []).length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No reviews here.</p>
        ) : (
          list.data!.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center text-amber-400">
                    {Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-amber-400" />)}
                  </span>
                  <span className="text-sm font-medium">{r.productTitle ?? 'Product'}</span>
                  <Badge variant={tone[r.status] ?? 'secondary'} className="text-[10px]">{r.status}</Badge>
                  {r.verified ? <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-600"><ShieldCheck className="h-3 w-3" /> verified</span> : null}
                </div>
                {r.title ? <p className="mt-1 text-sm font-medium">{r.title}</p> : null}
                {r.body ? <p className="text-sm text-muted-foreground">{r.body}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">{r.authorName}{r.createdAt ? ` · ${new Date(r.createdAt).toLocaleDateString()}` : ''}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                {r.status !== 'APPROVED' ? <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: 'APPROVED' })}><Check className="h-3.5 w-3.5" /></Button> : null}
                {r.status !== 'REJECTED' ? <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: 'REJECTED' })}><X className="h-3.5 w-3.5" /></Button> : null}
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
