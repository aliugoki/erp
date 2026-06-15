'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { LedgerEntry, Product, ReorderLine, StockReport } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function LedgerReportsPage() {
  const [productId, setProductId] = useState('');
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products') });
  const { data: stock } = useQuery({ queryKey: ['stock-report'], queryFn: () => apiGet<StockReport>('/inventory/reports/stock') });
  const { data: reorder } = useQuery({ queryKey: ['reorder'], queryFn: () => apiGet<ReorderLine[]>('/inventory/reports/reorder') });
  const { data: ledger } = useQuery({
    queryKey: ['item-ledger', productId],
    queryFn: () => apiGet<LedgerEntry[]>(`/inventory/products/${productId}/ledger`),
    enabled: !!productId,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Inventory" description="Inventory ledger & valuation reports." />
      <InventoryTabs />

      <Card className="p-4">
        <p className="mb-3 font-medium">Stock valuation</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead><TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(stock?.lines ?? []).map((l) => (
              <TableRow key={l.id}>
                <TableCell><span className="font-medium">{l.name}</span> <span className="font-mono text-xs text-muted-foreground">{l.sku}</span>{l.belowReorder ? <Badge variant="warning" className="ml-2">Reorder</Badge> : null}</TableCell>
                <TableCell className="text-right tabular-nums">{l.onHand} {l.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(l.unitCost.amountMinor, l.unitCost.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(l.value.amountMinor, l.value.currency)}</TableCell>
              </TableRow>
            ))}
            {stock ? (
              <TableRow className="border-t-2 font-semibold">
                <TableCell>Total ({stock.totals.items} items)</TableCell><TableCell /><TableCell />
                <TableCell className="text-right tabular-nums">{formatMoney(stock.totals.value.amountMinor, stock.totals.value.currency)}</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 font-medium">Reorder report</p>
          <Table>
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reorder</TableHead><TableHead className="text-right">Suggested</TableHead></TableRow></TableHeader>
            <TableBody>
              {(reorder ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name} <span className="font-mono text-xs text-muted-foreground">{r.sku}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{r.onHand}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.minStock}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{r.suggestedQty}</TableCell>
                </TableRow>
              ))}
              {reorder && reorder.length === 0 ? <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground">Everything is above its reorder point.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-medium">Item ledger</p>
            <div className="w-56">
              <Label className="sr-only">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Select a product" /></SelectTrigger>
                <SelectContent>{(products ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} · {p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Document</TableHead><TableHead className="text-right">In</TableHead><TableHead className="text-right">Out</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
            <TableBody>
              {(ledger ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell><span className="font-mono text-xs">{e.docNo ?? e.docType}</span><span className="ml-2 text-xs text-muted-foreground">{e.docType}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{e.qtyIn || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.qtyOut || ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.balanceQty} <span className="text-xs text-muted-foreground">({formatMoney(e.balanceValue.amountMinor, e.balanceValue.currency)})</span></TableCell>
                </TableRow>
              ))}
              {productId && ledger && ledger.length === 0 ? <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground">No movements yet.</TableCell></TableRow> : null}
              {!productId ? <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground">Pick a product to see its movement ledger.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
