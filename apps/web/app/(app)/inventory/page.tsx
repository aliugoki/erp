'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Package, PackageSearch } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Product } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { NewProductDialog } from '@/components/inventory/new-product-dialog';
import { MovementDialog } from '@/components/inventory/movement-dialog';
import { AdjustStockDialog } from '@/components/inventory/adjust-stock-dialog';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { ProductImagesDialog } from '@/components/inventory/product-images-dialog';
import { AuthImage } from '@/components/auth-image';
import { ImagePlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function InventoryPage() {
  const [moving, setMoving] = useState<Product | null>(null);
  const [imaging, setImaging] = useState<Product | null>(null);
  const { data: products, isLoading } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products') });

  const list = products ?? [];
  const lowStock = list.filter((p) => p.onHand < p.minStock);
  const stockValue = list.reduce((sum, p) => sum + p.onHand * p.costPrice.amountMinor, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Inventory" description="Stock master, procurement and store operations." action={<div className="flex gap-2"><AdjustStockDialog /><NewProductDialog /></div>} />
      <InventoryTabs />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Package} label="Products" value={list.length} delayMs={0} />
        <StatCard icon={AlertTriangle} label="Low stock" value={lowStock.length} accent={lowStock.length ? 'warning' : 'success'} delayMs={60} />
        <StatCard icon={PackageSearch} label="Stock value (cost)" value={Math.round(stockValue / 100)} format={(v) => `PKR ${v.toLocaleString()}`} delayMs={120} />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>On hand</TableHead>
              <TableHead>Sell price</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell />
                  </TableRow>
                ))
              : list.map((p) => {
                  const low = p.onHand < p.minStock;
                  return (
                    <TableRow key={p.id} className={cn(low && 'bg-warning/5')}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {low ? <span className="size-2 shrink-0 animate-glow-pulse rounded-full bg-warning shadow-[0_0_10px_hsl(var(--warning))]" /> : <span className="size-2 shrink-0 rounded-full bg-success/60" />}
                          <button className="shrink-0" onClick={() => setImaging(p)} title="Product images" aria-label="Product images">
                            <AuthImage path={p.primaryImageId ? `/inventory/products/${p.id}/images/${p.primaryImageId}` : null} alt={p.name} className="size-10 rounded-md border" />
                          </button>
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                            {p.categoryPath.length > 0 ? (
                              <p className="text-xs text-muted-foreground">{p.categoryPath.join(' › ')}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums">{p.onHand}</span>
                        <span className="ml-2 text-xs text-muted-foreground">min {p.minStock}</span>
                        {low ? <Badge variant="warning" className="ml-2">Low</Badge> : null}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatMoney(p.sellPrice.amountMinor, p.sellPrice.currency)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setImaging(p)} title="Images">
                            <ImagePlus className="h-4 w-4" />{p.imageCount ? <span className="ml-1 text-xs">{p.imageCount}</span> : null}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setMoving(p)}>Move stock</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>

        {!isLoading && list.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Package} title="No products" description="Add your first product to track stock." action={<NewProductDialog />} />
          </div>
        ) : null}
      </Card>

      <MovementDialog product={moving} onClose={() => setMoving(null)} />
      <ProductImagesDialog
        productId={imaging?.id ?? null}
        productName={imaging?.name}
        open={!!imaging}
        onOpenChange={(v) => !v && setImaging(null)}
      />
    </div>
  );
}
