'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiPost } from '@/lib/api';
import { apiGet } from '@/lib/api';
import type { EcCollection } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Catalogue groupings shown as filter chips on the storefront. */
export function CollectionsAdmin() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['ec-collections'], queryFn: () => apiGet<EcCollection[]>('/ecommerce/collections') });
  const [title, setTitle] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ec-collections'] });

  const create = useMutation({
    mutationFn: () => apiPost('/ecommerce/collections', { title, isFeatured: true }),
    onSuccess: () => { setTitle(''); toast.success('Collection added'); void invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/ecommerce/collections/${id}`),
    onSuccess: () => { toast.success('Removed'); void invalidate(); },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New collection (e.g. Apparel)" onKeyDown={(e) => { if (e.key === 'Enter' && title) create.mutate(); }} />
        <Button onClick={() => create.mutate()} disabled={!title || create.isPending}>
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Add
        </Button>
      </div>
      <div className="rounded-xl border divide-y">
        {(list.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No collections yet.</p>
        ) : (
          list.data!.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                {c.isFeatured ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : null}
                <span className="font-medium">{c.title}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{c.slug}</code>
                {c.productCount != null ? <span className="text-xs text-muted-foreground">· {c.productCount} products</span> : null}
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
