'use client';
import { ModuleTitle } from '@/components/module-title';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Boxes, ClipboardList, FileInput, FileOutput, Layers, Loader2, Save,
  Search, ShoppingCart, Truck, Undo2, Warehouse as WarehouseIcon, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { CategoryNode, GatePass, GrnRow, IssueRow, MrnRow, Product, PurchaseOrder, Requisition, StockReport } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { DirectionBadge, DocStatusBadge, fmtDate } from '@/components/inventory/inv-ui';
import { ProductDetail } from '@/components/inventory/product-detail';
import { RequisitionDetail } from '@/components/inventory/requisition-detail';
import { PoDetail } from '@/components/inventory/po-detail';
import { PostedDocDetail } from '@/components/inventory/posted-doc-detail';
import { GatePassDetail } from '@/components/inventory/gate-pass-detail';
import { InventoryReports } from '@/components/inventory/inventory-reports';
import { CategoryTreeNode } from '@/components/inventory/category-tree-node';
import { NewProductDialog } from '@/components/inventory/new-product-dialog';
import { BarcodeSheetDialog } from '@/components/codes/barcode-sheet';
import { GenerateMissingProductBarcodes } from '@/components/inventory/product-barcode';
import { NewCategoryDialog } from '@/components/inventory/new-category-dialog';
import { AdjustStockDialog } from '@/components/inventory/adjust-stock-dialog';
import { NewRequisitionDialog } from '@/components/inventory/new-requisition-dialog';
import { NewPoDialog } from '@/components/inventory/new-po-dialog';
import { NewGrnDialog } from '@/components/inventory/new-grn-dialog';
import { NewGatePassDialog } from '@/components/inventory/new-gate-pass-dialog';
import { NewIssueDialog } from '@/components/inventory/new-issue-dialog';
import { NewMrnDialog } from '@/components/inventory/new-mrn-dialog';

type Warehouse = { id: string; name: string; code: string | null; location: string | null; branchId: string | null };
type BranchOpt = { id: string; name: string };
type Section = 'products' | 'categories' | 'warehouses' | 'requisitions' | 'pos' | 'grns' | 'gatepasses' | 'issues' | 'mrns' | 'reports';

export default function InventoryPage() {
  const [section, setSection] = useState<Section>('products');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const products = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products') });
  const tree = useQuery({ queryKey: ['category-tree'], queryFn: () => apiGet<CategoryNode[]>('/inventory/categories/tree'), enabled: section === 'categories' });
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => apiGet<Warehouse[]>('/inventory/warehouses'), enabled: section === 'warehouses' });
  const requisitions = useQuery({ queryKey: ['requisitions'], queryFn: () => apiGet<Requisition[]>('/inventory/requisitions'), enabled: section === 'requisitions' });
  const pos = useQuery({ queryKey: ['purchase-orders'], queryFn: () => apiGet<PurchaseOrder[]>('/inventory/purchase-orders'), enabled: section === 'pos' });
  const grns = useQuery({ queryKey: ['grns'], queryFn: () => apiGet<GrnRow[]>('/inventory/grns'), enabled: section === 'grns' });
  const gatePasses = useQuery({ queryKey: ['gate-passes'], queryFn: () => apiGet<GatePass[]>('/inventory/gate-passes'), enabled: section === 'gatepasses' });
  const issues = useQuery({ queryKey: ['issues'], queryFn: () => apiGet<IssueRow[]>('/inventory/issues'), enabled: section === 'issues' });
  const mrns = useQuery({ queryKey: ['mrns'], queryFn: () => apiGet<MrnRow[]>('/inventory/mrns'), enabled: section === 'mrns' });
  const stockReport = useQuery({ queryKey: ['stock-report'], queryFn: () => apiGet<StockReport>('/inventory/reports/stock') });

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); };
  const clear = () => setSel(null);

  const prodList = useMemo(() => (products.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase())), [products.data, q]);
  const lowCount = (products.data ?? []).filter((p) => p.onHand < p.minStock).length;
  const openPos = (pos.data ?? []).filter((p) => !['RECEIVED', 'CLOSED', 'CANCELLED'].includes(p.status)).length;

  const showDetail = !!sel || section === 'reports';

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={Boxes} label="Products" count={products.data?.length} active={section === 'products'} onClick={() => pick('products')} />
      <RailItem icon={Layers} label="Categories" active={section === 'categories'} onClick={() => pick('categories')} tone="violet" />
      <RailItem icon={WarehouseIcon} label="Warehouses" active={section === 'warehouses'} onClick={() => pick('warehouses')} />
      <div className="my-1 border-t" />
      <RailItem icon={ClipboardList} label="Requisitions" active={section === 'requisitions'} onClick={() => pick('requisitions')} tone="sky" />
      <RailItem icon={ShoppingCart} label="Purchase Orders" active={section === 'pos'} onClick={() => pick('pos')} tone="amber" />
      <RailItem icon={FileInput} label="Receipts (GRN)" active={section === 'grns'} onClick={() => pick('grns')} tone="emerald" />
      <RailItem icon={Truck} label="Gate Passes" active={section === 'gatepasses'} onClick={() => pick('gatepasses')} />
      <RailItem icon={FileOutput} label="Issues" active={section === 'issues'} onClick={() => pick('issues')} tone="rose" />
      <RailItem icon={Undo2} label="Returns (MRN)" active={section === 'mrns'} onClick={() => pick('mrns')} tone="emerald" />
      <div className="my-1 border-t" />
      <RailItem icon={Wallet} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="violet" />
    </div>
  );

  const list = (
    <Pane>
      {section === 'products' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="h-9 w-full pl-9" /></div>
            <GenerateMissingProductBarcodes missing={(products.data ?? []).filter((p) => !p.barcode).length} />
            <AdjustStockDialog />
            <NewProductDialog />
          </PaneHeader>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <BarcodeSheetDialog
              rows={prodList.map((p) => ({
                id: p.id, code: p.barcode, name: p.name, sub: p.sku,
                price: formatMoney(p.sellPrice.amountMinor, p.sellPrice.currency),
              }))}
              title="Print product barcodes"
              triggerLabel={`Print barcodes (${prodList.filter((p) => p.barcode).length})`}
              emptyHint="No product here has a barcode yet — generate them first."
            />
            <span className="text-xs text-muted-foreground">Sticker sheet for the products listed</span>
          </div>
          <PaneBody>
            {products.isLoading ? <Spinner /> : prodList.length === 0 ? <Hint>No products.</Hint> : (
              <ul className="divide-y">{prodList.map((p) => {
                const low = p.onHand < p.minStock;
                return (<li key={p.id}><ListRow active={sel === p.id} onClick={() => setSel(p.id)}>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{p.name}</span>{low ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : null}</div><div className="truncate text-xs text-muted-foreground">{p.sku}{p.category ? ` · ${p.category}` : ''}</div></div>
                  <div className="text-right text-xs"><div className={`font-semibold tabular-nums ${low ? 'text-amber-600' : ''}`}>{p.onHand} {p.unit}</div><div className="text-muted-foreground">{formatMoney(p.sellPrice.amountMinor, p.sellPrice.currency)}</div></div>
                </ListRow></li>);
              })}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'categories' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Categories</span><NewCategoryDialog /></PaneHeader>
          <PaneBody className="p-2">
            {tree.isLoading ? <Spinner /> : (tree.data ?? []).length === 0 ? <Hint>No categories.</Hint> : (
              <div>{(tree.data ?? []).map((n) => <CategoryTreeNode key={n.id} node={n} depth={0} />)}</div>
            )}
          </PaneBody>
        </>
      ) : section === 'warehouses' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Warehouses</span></PaneHeader>
          <PaneBody>
            {warehouses.isLoading ? <Spinner /> : (warehouses.data ?? []).length === 0 ? <Hint>No warehouses.</Hint> : (
              <ul className="divide-y">{(warehouses.data ?? []).map((w) => (
                <li key={w.id}><ListRow active={sel === w.id} onClick={() => setSel(w.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{w.name}</div><div className="truncate text-xs text-muted-foreground">{[w.code, w.location].filter(Boolean).join(' · ') || '—'}</div></div>
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'requisitions' ? (
        <DocList query={requisitions} empty="No requisitions." header={<NewRequisitionDialog />} rows={(requisitions.data ?? []).map((r) => ({ id: r.id, title: r.req_no, sub: [r.requested_by, r.department].filter(Boolean).join(' · ') || fmtDate(r.needed_by), status: r.status }))} sel={sel} onSelect={setSel} />
      ) : section === 'pos' ? (
        <DocList query={pos} empty="No purchase orders." header={<NewPoDialog />} rows={(pos.data ?? []).map((p) => ({ id: p.id, title: p.po_no, sub: `${p.vendor ?? 'No vendor'} · ${formatMoney(p.total_minor, p.currency)}`, status: p.status }))} sel={sel} onSelect={setSel} />
      ) : section === 'grns' ? (
        <DocList query={grns} empty="No receipts." header={<NewGrnDialog />} rows={(grns.data ?? []).map((g) => ({ id: g.id, title: g.grn_no, sub: `${g.vendor ?? g.po_no ?? '—'} · ${g.qty} units`, status: g.status }))} sel={sel} onSelect={setSel} />
      ) : section === 'gatepasses' ? (
        <DocList query={gatePasses} empty="No gate passes." header={<NewGatePassDialog />} rows={(gatePasses.data ?? []).map((g) => ({ id: g.id, title: g.gp_no, sub: `${g.party ?? '—'} · ${g.direction}`, status: g.status, badge: <DirectionBadge direction={g.direction} /> }))} sel={sel} onSelect={setSel} />
      ) : section === 'issues' ? (
        <DocList query={issues} empty="No issues." header={<NewIssueDialog />} rows={(issues.data ?? []).map((i) => ({ id: i.id, title: i.issue_no, sub: `${i.issued_to ?? i.department ?? '—'} · ${i.qty} units`, status: i.status }))} sel={sel} onSelect={setSel} />
      ) : section === 'mrns' ? (
        <DocList query={mrns} empty="No returns." header={<NewMrnDialog />} rows={(mrns.data ?? []).map((n) => ({ id: n.id, title: n.mrn_no, sub: `${n.returned_by ?? '—'} · ${n.qty} units`, status: n.status }))} sel={sel} onSelect={setSel} />
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Analytics</span></PaneHeader><PaneBody><div className="p-2"><ListRow active><Wallet className="h-4 w-4 text-violet-600" /><span className="flex-1 font-medium">Stock valuation</span></ListRow></div></PaneBody></>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'products' ? (sel ? <ProductDetail id={sel} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={Boxes} title="Select a product" hint="Edit master data, manage images, and view movements + valued ledger." />)
        : section === 'categories' ? <EmptyDetail icon={Layers} title="Product categories" hint="A three-level tree. Add, rename, and remove categories inline on the left." />
        : section === 'warehouses' ? (sel ? <WarehouseDetail id={sel} warehouse={(warehouses.data ?? []).find((w) => w.id === sel)} onBack={clear} /> : <EmptyDetail icon={WarehouseIcon} title="Warehouses" hint="Select a warehouse to edit its details." />)
        : section === 'requisitions' ? (sel ? <RequisitionDetail id={sel} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={ClipboardList} title="Select a requisition" hint="Submit, approve, and issue stock against requisitions." />)
        : section === 'pos' ? (sel ? <PoDetail id={sel} onBack={clear} /> : <EmptyDetail icon={ShoppingCart} title="Select a purchase order" hint="Approve, cancel, and receive goods (GRN)." />)
        : section === 'grns' ? (sel ? <PostedDocDetail kind="grn" id={sel} onBack={clear} /> : <EmptyDetail icon={FileInput} title="Select a receipt" hint="Goods received into the valued ledger." />)
        : section === 'gatepasses' ? (sel ? <GatePassDetail id={sel} onBack={clear} /> : <EmptyDetail icon={Truck} title="Select a gate pass" hint="Inward/outward goods movement records." />)
        : section === 'issues' ? (sel ? <PostedDocDetail kind="issue" id={sel} onBack={clear} /> : <EmptyDetail icon={FileOutput} title="Select an issue" hint="Stock issued out of the store." />)
        : section === 'mrns' ? (sel ? <PostedDocDetail kind="mrn" id={sel} onBack={clear} /> : <EmptyDetail icon={Undo2} title="Select a return" hint="Material returned back into the store." />)
        : <InventoryReports />}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <ModuleTitle>Inventory</ModuleTitle>
        <p className="text-sm text-muted-foreground">Products, valued stock ledger, and procurement documents.</p>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Products" value={products.data ? String(products.data.length) : '—'} icon={Boxes} />
        <Kpi label="Low stock" value={String(lowCount)} icon={AlertTriangle} tone={lowCount > 0 ? 'amber' : 'default'} />
        <Kpi label="Stock value" value={stockReport.data ? formatMoney(stockReport.data.totals.value.amountMinor, stockReport.data.totals.value.currency) : '—'} icon={Wallet} tone="emerald" />
        <Kpi label="Open POs" value={section === 'pos' ? String(openPos) : '—'} icon={ShoppingCart} tone="sky" />
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

interface DocRow { id: string; title: string; sub: string; status: string; badge?: React.ReactNode }
function DocList({ query, empty, rows, header, sel, onSelect }: { query: { isLoading: boolean }; empty: string; rows: DocRow[]; header: React.ReactNode; sel: string | null; onSelect: (id: string) => void }) {
  return (
    <>
      <PaneHeader><span className="flex-1 text-sm font-medium">Documents</span>{header}</PaneHeader>
      <PaneBody>
        {query.isLoading ? <Spinner /> : rows.length === 0 ? <Hint>{empty}</Hint> : (
          <ul className="divide-y">{rows.map((r) => (
            <li key={r.id}><ListRow active={sel === r.id} onClick={() => onSelect(r.id)}>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.title}</div><div className="truncate text-xs text-muted-foreground">{r.sub}</div></div>
              {r.badge ?? <DocStatusBadge status={r.status} />}
            </ListRow></li>
          ))}</ul>
        )}
      </PaneBody>
    </>
  );
}

function WarehouseDetail({ id, warehouse, onBack }: { id: string; warehouse?: Warehouse; onBack?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: warehouse?.name ?? '', code: warehouse?.code ?? '', location: warehouse?.location ?? '', branchId: warehouse?.branchId ?? '' });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => apiGet<BranchOpt[]>('/branches') });
  const save = useMutation({
    mutationFn: () => apiPatch(`/inventory/warehouses/${id}`, { name: f.name, code: f.code || undefined, location: f.location || undefined, branchId: f.branchId || undefined }),
    onSuccess: () => { toast.success('Warehouse saved'); void qc.invalidateQueries({ queryKey: ['warehouses'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  return (
    <>
      <PaneHeader>{onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}<span className="flex-1 truncate font-semibold">{warehouse?.name ?? 'Warehouse'}</span></PaneHeader>
      <PaneBody className="p-5">
        <div className="grid max-w-md gap-4">
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Name</span><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></label>
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Code</span><Input value={f.code} onChange={(e) => setF((s) => ({ ...s, code: e.target.value }))} /></label>
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Location</span><Input value={f.location} onChange={(e) => setF((s) => ({ ...s, location: e.target.value }))} /></label>
          {(branches.data ?? []).length > 0 ? (
            <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Branch</span>
              <select value={f.branchId} onChange={(e) => setF((s) => ({ ...s, branchId: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">—</option>
                {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          ) : null}
          <div><Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </div>
      </PaneBody>
    </>
  );
}

function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }
function Kpi({ label, value, icon: Icon, tone = 'default' }: { label: string; value: string; icon: typeof Boxes; tone?: 'default' | 'amber' | 'emerald' | 'sky' }) {
  const tones: Record<string, string> = { default: 'text-primary', amber: 'text-amber-600', emerald: 'text-emerald-600', sky: 'text-sky-600' };
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tones[tone]}`} /></div><p className="mt-2 text-xl font-bold tabular-nums">{value}</p></div>;
}
