'use client';
import { useQuery } from '@tanstack/react-query';
import { FolderTree } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { CategoryNode } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { NewCategoryDialog } from '@/components/inventory/new-category-dialog';
import { CategoryTreeNode } from '@/components/inventory/category-tree-node';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function countNodes(nodes: CategoryNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

export default function CategoriesPage() {
  const { data: tree, isLoading } = useQuery({
    queryKey: ['category-tree'],
    queryFn: () => apiGet<CategoryNode[]>('/inventory/categories/tree'),
  });

  const roots = tree ?? [];
  const total = countNodes(roots);

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-up">
      <PageHeader
        title="Inventory"
        description="Organise products in a category tree, up to three levels deep."
        action={<NewCategoryDialog />}
      />
      <InventoryTabs />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard icon={FolderTree} label="Categories" value={total} delayMs={0} />
        <StatCard icon={FolderTree} label="Top-level groups" value={roots.length} delayMs={60} />
      </div>

      <Card className="overflow-hidden p-2">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : roots.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={FolderTree}
              title="No categories yet"
              description="Create a top-level category, then nest sub-categories beneath it."
              action={<NewCategoryDialog />}
            />
          </div>
        ) : (
          <ul className="divide-y">
            {roots.map((node) => (
              <CategoryTreeNode key={node.id} node={node} depth={0} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
