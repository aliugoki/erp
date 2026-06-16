'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiDelete } from '@/lib/api';
import type { CategoryNode } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NewCategoryDialog } from '@/components/inventory/new-category-dialog';

const MAX_LEVEL = 3;
const LEVEL_LABEL: Record<number, string> = { 1: 'Category', 2: 'Sub-category', 3: 'Sub-sub-category' };

/** One node in the category tree, rendered recursively. Indented by depth; offers an "add sub" action
 * until the third level and a delete the server only honours for empty leaves. */
export function CategoryTreeNode({ node, depth }: { node: CategoryNode; depth: number }) {
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: () => apiDelete(`/inventory/categories/${node.id}`),
    onSuccess: () => {
      toast.success('Category removed', { description: node.name });
      qc.invalidateQueries({ queryKey: ['category-tree'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e) => toast.error('Could not remove category', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <li>
      <div className="flex items-center gap-3 py-2 pr-2 transition-colors hover:bg-muted/40" style={{ paddingLeft: depth * 24 + 8 }}>
        <FolderTree className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{node.name}</span>
        {node.code ? <span className="font-mono text-xs text-muted-foreground">{node.code}</span> : null}
        <Badge variant="secondary" className="text-[10px]">{LEVEL_LABEL[node.level] ?? `L${node.level}`}</Badge>
        <span className="text-xs text-muted-foreground">
          {node.productCount} product{node.productCount === 1 ? '' : 's'}
          {node.childCount ? ` · ${node.childCount} sub` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {node.level < MAX_LEVEL ? (
            <NewCategoryDialog
              defaultParentId={node.id}
              trigger={
                <Button size="sm" variant="ghost" className="h-7 px-2">
                  <Plus className="size-3.5" /> Sub
                </Button>
              }
            />
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            aria-label={`Delete ${node.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {node.children.length > 0 ? (
        <ul className="divide-y border-t">
          {node.children.map((child) => (
            <CategoryTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
