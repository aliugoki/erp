'use client';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Category } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ROOT = '__root__';
const MAX_LEVEL = 3;

/** Create a category at any of the three levels. Picking a parent nests the new node one level below
 * it; categories at the deepest level can't be parents, so they aren't offered. */
export function NewCategoryDialog({
  defaultParentId,
  trigger,
}: {
  defaultParentId?: string;
  trigger?: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [parentId, setParentId] = useState(defaultParentId ?? ROOT);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiGet<Category[]>('/inventory/categories'),
  });
  // Only levels 1–2 may parent another category (a level-3 node is already the deepest).
  const parents = (categories ?? []).filter((c) => c.level < MAX_LEVEL);

  const create = useMutation({
    mutationFn: () =>
      apiPost('/inventory/categories', {
        name: name.trim(),
        code: code.trim() || undefined,
        parentId: parentId === ROOT ? undefined : parentId,
      }),
    onSuccess: () => {
      toast.success('Category added', { description: name });
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['category-tree'] });
      setOpen(false);
      setName('');
      setCode('');
      setParentId(defaultParentId ?? ROOT);
    },
    onError: (e) => toast.error('Could not add category', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" /> New category
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add category</DialogTitle>
          <DialogDescription>Group products in a tree up to three levels deep.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-parent">Parent</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="cat-parent">
                <SelectValue placeholder="Top level (no parent)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT}>Top level (no parent)</SelectItem>
                {parents.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {' '.repeat((c.level - 1) * 2)}
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Electronics" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-code">Code (optional)</Label>
              <Input id="cat-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ELEC" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? 'Adding…' : 'Add category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
