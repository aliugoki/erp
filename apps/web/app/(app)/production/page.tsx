'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Factory, Gauge, Layers, PackageCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import type { Bom, MaterialShortage, ProductionAttribute, ProductionOrder, WorkCenter } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { NewAttributeDialog } from '@/components/production/new-attribute-dialog';
import { NewBomDialog } from '@/components/production/new-bom-dialog';
import { NewOrderDialog } from '@/components/production/new-order-dialog';
import { NewWorkCenterDialog } from '@/components/production/new-work-center-dialog';
import { OrderDetailDialog } from '@/components/production/order-detail-dialog';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const TABS = ['orders', 'boms', 'work-centers', 'attributes', 'costing'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { orders: 'Orders', boms: 'BOMs', 'work-centers': 'Work centers', attributes: 'Attributes', costing: 'Costing → GL' };
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline', PLANNED: 'secondary', RELEASED: 'secondary', IN_PROGRESS: 'default', COMPLETED: 'default', CANCELLED: 'destructive',
  ACTIVE: 'default', ARCHIVED: 'outline',
};

export default function ProductionPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('orders');
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  const orders = useQuery({ queryKey: ['prod-orders'], queryFn: () => apiGet<ProductionOrder[]>('/production/orders') });
  const boms = useQuery({ queryKey: ['prod-boms'], queryFn: () => apiGet<Bom[]>('/production/boms') });
  const workCenters = useQuery({ queryKey: ['prod-work-centers'], queryFn: () => apiGet<WorkCenter[]>('/production/work-centers') });
  const attributes = useQuery({ queryKey: ['prod-attributes'], queryFn: () => apiGet<ProductionAttribute[]>('/production/attributes') });
  const shortages = useQuery({ queryKey: ['prod-shortages'], queryFn: () => apiGet<MaterialShortage[]>('/production/reports/shortages') });

  const list = orders.data ?? [];
  const inProgress = list.filter((o) => ['RELEASED', 'IN_PROGRESS', 'PLANNED'].includes(o.status));
  const wipValue = inProgress.reduce((s, o) => s + o.totalCost.amountMinor, 0);
  const completed = list.filter((o) => o.status === 'COMPLETED');
  const currency = list[0]?.totalCost.currency ?? 'PKR';

  const setBomStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPost(`/production/boms/${id}/status`, { status }),
    onSuccess: () => { toast.success('BOM updated'); void qc.invalidateQueries({ queryKey: ['prod-boms'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const delAttr = useMutation({
    mutationFn: (id: string) => apiDelete(`/production/attributes/${id}`),
    onSuccess: () => { toast.success('Attribute removed'); void qc.invalidateQueries({ queryKey: ['prod-attributes'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Manufacturing" description="Bills of materials, work centers, and production orders with live costing." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Factory} label="Orders in progress" value={inProgress.length} accent="primary" delayMs={0} />
        <StatCard icon={Gauge} label="WIP value" value={wipValue} format={(v) => formatMoney(v, currency)} accent="warning" delayMs={60} />
        <StatCard icon={PackageCheck} label="Completed orders" value={completed.length} accent="success" delayMs={120} />
        <StatCard icon={AlertTriangle} label="Material shortages" value={shortages.data?.length ?? 0} accent="destructive" delayMs={180} />
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between gap-2 border-b">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="pb-1">
          {tab === 'orders' ? <NewOrderDialog /> : null}
          {tab === 'boms' ? <NewBomDialog /> : null}
          {tab === 'work-centers' ? <NewWorkCenterDialog /> : null}
          {tab === 'attributes' ? <NewAttributeDialog /> : null}
        </div>
      </div>

      {/* Orders */}
      {tab === 'orders' ? (
        <div className="space-y-2">
          {(shortages.data ?? []).length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-destructive">Short of:</span>
              {(shortages.data ?? []).slice(0, 5).map((s) => (
                <Badge key={s.componentProductId} variant="outline">{s.componentName} (−{s.shortBy})</Badge>
              ))}
            </div>
          ) : null}
          <Table
            empty="No production orders yet."
            rows={list}
            cols={['Order', 'Product', 'Qty', 'Total cost', 'Status']}
            render={(o: ProductionOrder) => (
              <tr key={o.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpenOrder(o.id)}>
                <Td className="font-medium">{o.orderNo}</Td>
                <Td>{o.productName}</Td>
                <Td>{o.producedQty}/{o.plannedQty}</Td>
                <Td className="tabular-nums">{formatMoney(o.totalCost.amountMinor, o.totalCost.currency)}</Td>
                <Td><Badge variant={STATUS_VARIANT[o.status] ?? 'outline'}>{o.status}</Badge></Td>
              </tr>
            )}
          />
        </div>
      ) : null}

      {/* BOMs */}
      {tab === 'boms' ? (
        <Table
          empty="No BOMs yet. Create one to define how a product is made."
          rows={boms.data ?? []}
          cols={['BOM', 'Product', 'Name', 'Output', 'Status', '']}
          render={(b: Bom) => (
            <tr key={b.id} className="border-t">
              <Td className="font-medium">{b.bomNo}</Td>
              <Td>{b.productName}</Td>
              <Td>{b.name}</Td>
              <Td>{b.outputQty}</Td>
              <Td><Badge variant={STATUS_VARIANT[b.status] ?? 'outline'}>{b.status}</Badge></Td>
              <Td>
                {b.status !== 'ACTIVE' ? (
                  <Button size="sm" variant="outline" onClick={() => setBomStatus.mutate({ id: b.id, status: 'ACTIVE' })}>Activate</Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setBomStatus.mutate({ id: b.id, status: 'ARCHIVED' })}>Archive</Button>
                )}
              </Td>
            </tr>
          )}
        />
      ) : null}

      {/* Work centers */}
      {tab === 'work-centers' ? (
        <Table
          empty="No work centers. Add stations to cost operations."
          rows={workCenters.data ?? []}
          cols={['Name', 'Code', 'Cost / hour', 'Status']}
          render={(w: WorkCenter) => (
            <tr key={w.id} className="border-t">
              <Td className="font-medium">{w.name}</Td>
              <Td>{w.code ?? '—'}</Td>
              <Td className="tabular-nums">{formatMoney(w.costPerHour.amountMinor, w.costPerHour.currency)}</Td>
              <Td><Badge variant={w.status === 'ACTIVE' ? 'secondary' : 'outline'}>{w.status}</Badge></Td>
            </tr>
          )}
        />
      ) : null}

      {/* Attributes */}
      {tab === 'attributes' ? (
        <Table
          empty="No custom attributes. Add fields captured on every production order."
          rows={attributes.data ?? []}
          cols={['Label', 'Key', 'Type', 'Required', '']}
          render={(a: ProductionAttribute) => (
            <tr key={a.id} className="border-t">
              <Td className="font-medium">{a.label}</Td>
              <Td className="font-mono text-xs">{a.attrKey}</Td>
              <Td>{a.dataType}</Td>
              <Td>{a.required ? 'Yes' : 'No'}</Td>
              <Td>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => delAttr.mutate(a.id)} aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Td>
            </tr>
          )}
        />
      ) : null}

      {tab === 'costing' ? (
        <GlAccountsCard
          title="Production → general ledger"
          description="When set, completing an order posts Dr finished-goods inventory; Cr raw materials, labour, and overhead. Requires background reactions enabled."
          getPath="/production/gl-config"
          putPath="/production/gl-config"
          queryKey="production-gl-config"
          slots={[
            { key: 'fgInventoryAccountId', label: 'Finished goods (Dr)', types: ['ASSET'], required: true },
            { key: 'rawMaterialsAccountId', label: 'Raw materials (Cr)', types: ['ASSET'], required: true },
            { key: 'laborAccountId', label: 'Labour applied (Cr)' },
            { key: 'overheadAccountId', label: 'Overhead applied (Cr)' },
          ]}
        />
      ) : null}

      <OrderDetailDialog orderId={openOrder} open={!!openOrder} onOpenChange={(v) => !v && setOpenOrder(null)} />
    </div>
  );
}

function Table<T>({ rows, cols, render, empty }: { rows: T[]; cols: string[]; render: (r: T) => React.ReactNode; empty: string }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>{cols.map((c, i) => <th key={i} className="px-4 py-2 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-muted-foreground"><Layers className="mx-auto mb-2 h-5 w-5" />{empty}</td></tr>
          ) : (
            rows.map(render)
          )}
        </tbody>
      </table>
    </div>
  );
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
