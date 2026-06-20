'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Boxes, Factory, Layers, Loader2, Search, Settings2, Tag, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet } from '@/lib/api';
import type { Bom, ProductionAttribute, ProductionOrder, WorkCenter } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { PriorityBadge, ProdBadge } from '@/components/production/prod-ui';
import { OrderDetail } from '@/components/production/order-detail';
import { BomDetail } from '@/components/production/bom-detail';
import { WorkCenterDetail } from '@/components/production/work-center-detail';
import { ProductionReports } from '@/components/production/production-reports';
import { NewOrderDialog } from '@/components/production/new-order-dialog';
import { NewBomDialog } from '@/components/production/new-bom-dialog';
import { NewWorkCenterDialog } from '@/components/production/new-work-center-dialog';
import { NewAttributeDialog } from '@/components/production/new-attribute-dialog';

type Section = 'orders' | 'boms' | 'workcenters' | 'attributes' | 'reports' | 'costing';

export default function ProductionPage() {
  const [section, setSection] = useState<Section>('orders');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [orderStatus, setOrderStatus] = useState('');

  const orders = useQuery({ queryKey: ['prod-orders'], queryFn: () => apiGet<ProductionOrder[]>('/production/orders'), enabled: section === 'orders' });
  const boms = useQuery({ queryKey: ['prod-boms'], queryFn: () => apiGet<Bom[]>('/production/boms'), enabled: section === 'boms' });
  const workCenters = useQuery({ queryKey: ['prod-work-centers'], queryFn: () => apiGet<WorkCenter[]>('/production/work-centers'), enabled: section === 'workcenters' });
  const attributes = useQuery({ queryKey: ['prod-attributes'], queryFn: () => apiGet<ProductionAttribute[]>('/production/attributes'), enabled: section === 'attributes' });

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); };
  const clear = () => setSel(null);
  const fullPane = section === 'reports' || section === 'costing';
  const showDetail = !!sel || fullPane;

  const orderList = useMemo(() => (orders.data ?? []).filter((o) => (!q || `${o.orderNo} ${o.productName ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!orderStatus || o.status === orderStatus)), [orders.data, q, orderStatus]);
  const bomList = useMemo(() => (boms.data ?? []).filter((b) => !q || `${b.bomNo} ${b.name} ${b.productName ?? ''}`.toLowerCase().includes(q.toLowerCase())), [boms.data, q]);

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={Factory} label="Work Orders" count={orders.data?.length} active={section === 'orders'} onClick={() => pick('orders')} />
      <RailItem icon={Layers} label="Bills of Materials" active={section === 'boms'} onClick={() => pick('boms')} tone="violet" />
      <RailItem icon={Settings2} label="Work Centers" active={section === 'workcenters'} onClick={() => pick('workcenters')} tone="sky" />
      <RailItem icon={Tag} label="Attributes" active={section === 'attributes'} onClick={() => pick('attributes')} tone="amber" />
      <div className="my-1 border-t" />
      <RailItem icon={BarChart3} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="violet" />
      <RailItem icon={Wallet} label="Costing" active={section === 'costing'} onClick={() => pick('costing')} />
    </div>
  );

  const list = (
    <Pane>
      {section === 'orders' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders…" className="h-9 w-full pl-9" /></div>
            <select value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">All</option>{['DRAFT', 'PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
            <NewOrderDialog />
          </PaneHeader>
          <PaneBody>
            {orders.isLoading ? <Spinner /> : orderList.length === 0 ? <Hint>No work orders.</Hint> : (
              <ul className="divide-y">{orderList.map((o) => (
                <li key={o.id}><ListRow active={sel === o.id} onClick={() => setSel(o.id)}>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{o.orderNo}</span><PriorityBadge priority={o.priority} /></div><div className="truncate text-xs text-muted-foreground">{o.productName ?? '—'} · {o.plannedQty} pcs</div></div>
                  <ProdBadge status={o.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'boms' ? (
        <>
          <PaneHeader><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search BOMs…" className="h-9 w-full pl-9" /></div><NewBomDialog /></PaneHeader>
          <PaneBody>
            {boms.isLoading ? <Spinner /> : bomList.length === 0 ? <Hint>No BOMs.</Hint> : (
              <ul className="divide-y">{bomList.map((b) => (
                <li key={b.id}><ListRow active={sel === b.id} onClick={() => setSel(b.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{b.name}</div><div className="truncate text-xs text-muted-foreground">{b.bomNo} · {b.productName ?? ''}</div></div>
                  <ProdBadge status={b.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'workcenters' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Work centers</span><NewWorkCenterDialog /></PaneHeader>
          <PaneBody>
            {workCenters.isLoading ? <Spinner /> : (workCenters.data ?? []).length === 0 ? <Hint>No work centers.</Hint> : (
              <ul className="divide-y">{(workCenters.data ?? []).map((w) => (
                <li key={w.id}><ListRow active={sel === w.id} onClick={() => setSel(w.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{w.name}</div><div className="truncate text-xs text-muted-foreground">{w.code ?? ''} · {formatMoney(w.costPerHour.amountMinor, w.costPerHour.currency)}/hr</div></div>
                  <ProdBadge status={w.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'attributes' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Custom attributes</span><NewAttributeDialog /></PaneHeader>
          <PaneBody><AttributesList attributes={attributes.data ?? []} loading={attributes.isLoading} /></PaneBody>
        </>
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium capitalize">{section}</span></PaneHeader><PaneBody><div className="p-2"><ListRow active><Wallet className="h-4 w-4 text-violet-600" /><span className="flex-1 font-medium capitalize">{section}</span></ListRow></div></PaneBody></>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'orders' ? (sel ? <OrderDetail id={sel} onBack={clear} /> : <EmptyDetail icon={Factory} title="Select a work order" hint="Plan, release, issue materials, and complete." />)
        : section === 'boms' ? (sel ? <BomDetail id={sel} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={Layers} title="Select a BOM" hint="Components, operations, and version status." />)
        : section === 'workcenters' ? (sel ? <WorkCenterDetail workCenter={(workCenters.data ?? []).find((w) => w.id === sel)!} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={Settings2} title="Select a work center" hint="Edit machine/labour cost rates." />)
        : section === 'attributes' ? <EmptyDetail icon={Tag} title="Custom attributes" hint="EAV fields captured on each work order. Add or remove on the left." />
        : section === 'reports' ? <ProductionReports />
        : (
          <>
            <PaneHeader><span className="font-semibold">Manufacturing → general ledger</span></PaneHeader>
            <PaneBody className="p-5">
              <GlAccountsCard
                title="Manufacturing → general ledger"
                description="When set, each completed order posts Dr finished goods; Cr raw materials / labour / overhead. Requires background reactions enabled."
                getPath="/production/gl-config" putPath="/production/gl-config" queryKey="production-gl-config"
                slots={[
                  { key: 'fgInventoryAccountId', label: 'Finished goods (Dr)', types: ['ASSET'], required: true },
                  { key: 'rawMaterialsAccountId', label: 'Raw materials (Cr)', types: ['ASSET'], required: true },
                  { key: 'laborAccountId', label: 'Labour applied (Cr)' },
                  { key: 'overheadAccountId', label: 'Overhead applied (Cr)' },
                ]}
              />
            </PaneBody>
          </>
        )}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Manufacturing</h1>
        <p className="text-sm text-muted-foreground">Work orders, bills of materials, work centers, and production costing.</p>
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

function AttributesList({ attributes, loading }: { attributes: ProductionAttribute[]; loading: boolean }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/production/attributes/${id}`),
    onSuccess: () => { toast.success('Attribute removed'); void qc.invalidateQueries({ queryKey: ['prod-attributes'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  if (loading) return <Spinner />;
  if (attributes.length === 0) return <Hint>No attributes.</Hint>;
  return (
    <ul className="divide-y">{attributes.map((a) => (
      <li key={a.id} className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{a.label}</span><Boxes className="h-3 w-3 text-muted-foreground" /></div><div className="truncate text-xs text-muted-foreground">{a.attrKey} · {a.dataType}{a.required ? ' · required' : ''}</div></div>
        <Button variant="ghost" size="icon" onClick={() => remove.mutate(a.id)} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
      </li>
    ))}</ul>
  );
}

function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }
