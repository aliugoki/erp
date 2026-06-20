'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Building2, Layers, Loader2, Search, Wallet, Wrench } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Asset, AssetCategory, AssetMaintenance } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { AssetBadge, fmtDate, methodLabel } from '@/components/assets/asset-ui';
import { AssetDetail } from '@/components/assets/asset-detail';
import { CategoryDetail } from '@/components/assets/category-detail';
import { AssetReports } from '@/components/assets/asset-reports';
import { GlConfigCard } from '@/components/assets/gl-config-card';
import { NewAssetDialog } from '@/components/assets/new-asset-dialog';
import { NewCategoryDialog } from '@/components/assets/new-category-dialog';
import { NewMaintenanceDialog } from '@/components/assets/new-maintenance-dialog';

type Section = 'assets' | 'categories' | 'maintenance' | 'reports' | 'costing';
const STATUSES = ['DRAFT', 'ACTIVE', 'DISPOSED', 'WRITTEN_OFF'];

export default function AssetsPage() {
  const [section, setSection] = useState<Section>('assets');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const assets = useQuery({ queryKey: ['assets'], queryFn: () => apiGet<Asset[]>('/assets'), enabled: section === 'assets' });
  const categories = useQuery({ queryKey: ['asset-categories'], queryFn: () => apiGet<AssetCategory[]>('/assets/categories'), enabled: section === 'categories' });
  const maintenance = useQuery({ queryKey: ['asset-maintenance'], queryFn: () => apiGet<AssetMaintenance[]>('/assets/maintenance'), enabled: section === 'maintenance' });

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); };
  const clear = () => setSel(null);
  const fullPane = section === 'reports' || section === 'costing' || section === 'maintenance';
  const showDetail = !!sel || fullPane;

  const assetList = useMemo(() => (assets.data ?? []).filter((a) => (!q || `${a.assetNo} ${a.name} ${a.serialNo ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!status || a.status === status)), [assets.data, q, status]);

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={Building2} label="Assets" count={assets.data?.length} active={section === 'assets'} onClick={() => pick('assets')} />
      <RailItem icon={Layers} label="Categories" active={section === 'categories'} onClick={() => pick('categories')} tone="violet" />
      <RailItem icon={Wrench} label="Maintenance" active={section === 'maintenance'} onClick={() => pick('maintenance')} tone="amber" />
      <div className="my-1 border-t" />
      <RailItem icon={BarChart3} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="violet" />
      <RailItem icon={Wallet} label="Costing" active={section === 'costing'} onClick={() => pick('costing')} />
    </div>
  );

  const list = (
    <Pane>
      {section === 'assets' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets…" className="h-9 w-full pl-9" /></div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
            <NewAssetDialog />
          </PaneHeader>
          <PaneBody>
            {assets.isLoading ? <Spinner /> : assetList.length === 0 ? <Hint>No assets.</Hint> : (
              <ul className="divide-y">{assetList.map((a) => (
                <li key={a.id}><ListRow active={sel === a.id} onClick={() => setSel(a.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{a.name}</div><div className="truncate text-xs text-muted-foreground">{a.assetNo}{a.categoryName ? ` · ${a.categoryName}` : ''}</div></div>
                  <div className="flex flex-col items-end gap-1"><span className="text-xs font-semibold tabular-nums">{formatMoney(a.bookValue.amountMinor, a.bookValue.currency)}</span><AssetBadge status={a.status} /></div>
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'categories' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Categories</span><NewCategoryDialog /></PaneHeader>
          <PaneBody>
            {categories.isLoading ? <Spinner /> : (categories.data ?? []).length === 0 ? <Hint>No categories.</Hint> : (
              <ul className="divide-y">{(categories.data ?? []).map((c) => (
                <li key={c.id}><ListRow active={sel === c.id} onClick={() => setSel(c.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.name}</div><div className="truncate text-xs text-muted-foreground">{methodLabel(c.method)} · {c.usefulLifeMonths} mo</div></div>
                  <AssetBadge status={c.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'maintenance' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Maintenance log</span><NewMaintenanceDialog /></PaneHeader>
          <PaneBody>
            {maintenance.isLoading ? <Spinner /> : (maintenance.data ?? []).length === 0 ? <Hint>No maintenance records.</Hint> : (
              <ul className="divide-y">{(maintenance.data ?? []).map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{m.assetName ?? '—'}</span><span className="text-xs font-semibold tabular-nums">{formatMoney(m.cost.amountMinor, m.cost.currency)}</span></div>
                  <div className="truncate text-xs text-muted-foreground">{m.type} · {fmtDate(m.maintDate)}{m.vendor ? ` · ${m.vendor}` : ''}{m.nextDueDate ? ` · next ${fmtDate(m.nextDueDate)}` : ''}</div>
                  {m.description ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{m.description}</div> : null}
                </li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium capitalize">{section}</span></PaneHeader><PaneBody><div className="p-2"><ListRow active><Wallet className="h-4 w-4 text-violet-600" /><span className="flex-1 font-medium capitalize">{section}</span></ListRow></div></PaneBody></>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'assets' ? (sel ? <AssetDetail id={sel} onBack={clear} /> : <EmptyDetail icon={Building2} title="Select an asset" hint="Edit details, run lifecycle actions, and view depreciation." />)
        : section === 'categories' ? (sel ? <CategoryDetail category={(categories.data ?? []).find((c) => c.id === sel)!} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={Layers} title="Select a category" hint="Edit the depreciation policy or remove a class." />)
        : section === 'maintenance' ? <EmptyDetail icon={Wrench} title="Maintenance log" hint="Repairs, services, and inspections. Add records on the left." />
        : section === 'reports' ? <AssetReports />
        : (
          <>
            <PaneHeader><span className="font-semibold">Assets → general ledger</span></PaneHeader>
            <PaneBody className="p-5"><GlConfigCard /></PaneBody>
          </>
        )}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fixed Assets</h1>
        <p className="text-sm text-muted-foreground">Asset register, depreciation, disposal, and maintenance.</p>
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }
