'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarClock, Layers, TrendingDown, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Asset, AssetCategory, AssetDepreciationRun, AssetMaintenance, AssetRegisterRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { AssetDetailDialog } from '@/components/assets/asset-detail-dialog';
import { NewAssetDialog } from '@/components/assets/new-asset-dialog';
import { NewCategoryDialog } from '@/components/assets/new-category-dialog';
import { NewMaintenanceDialog } from '@/components/assets/new-maintenance-dialog';
import { RunDepreciationDialog } from '@/components/assets/run-depreciation-dialog';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';

const TABS = ['assets', 'categories', 'depreciation', 'maintenance'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { assets: 'Assets', categories: 'Categories', depreciation: 'Depreciation', maintenance: 'Maintenance' };
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline', ACTIVE: 'default', DISPOSED: 'secondary', WRITTEN_OFF: 'destructive', INACTIVE: 'outline',
};

export default function AssetsPage() {
  const [tab, setTab] = useState<Tab>('assets');
  const [openAsset, setOpenAsset] = useState<string | null>(null);

  const assets = useQuery({ queryKey: ['assets'], queryFn: () => apiGet<Asset[]>('/assets') });
  const categories = useQuery({ queryKey: ['asset-categories'], queryFn: () => apiGet<AssetCategory[]>('/assets/categories') });
  const runs = useQuery({ queryKey: ['asset-runs'], queryFn: () => apiGet<AssetDepreciationRun[]>('/assets/depreciation/runs') });
  const register = useQuery({ queryKey: ['asset-register'], queryFn: () => apiGet<AssetRegisterRow[]>('/assets/reports/register') });
  const maintenance = useQuery({ queryKey: ['asset-maintenance'], queryFn: () => apiGet<AssetMaintenance[]>('/assets/maintenance') });
  const upcoming = useQuery({ queryKey: ['asset-upcoming'], queryFn: () => apiGet<AssetMaintenance[]>('/assets/maintenance/upcoming') });

  const list = assets.data ?? [];
  const active = list.filter((a) => a.status === 'ACTIVE');
  const reg = register.data ?? [];
  const bookValue = reg.reduce((s, r) => s + r.bookValue.amountMinor, 0);
  const currency = list[0]?.acquisitionCost.currency ?? reg[0]?.bookValue.currency ?? 'PKR';
  const lastRun = runs.data?.[0];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Fixed Assets" description="Asset register, depreciation, disposal, and maintenance — with book values and costing." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Active assets" value={active.length} accent="primary" delayMs={0} />
        <StatCard icon={Wallet} label="Net book value" value={bookValue} format={(v) => formatMoney(v, currency)} accent="success" delayMs={60} />
        <StatCard icon={TrendingDown} label="Last depreciation" value={lastRun?.total.amountMinor ?? 0} format={(v) => formatMoney(v, currency)} accent="warning" delayMs={120} />
        <StatCard icon={CalendarClock} label="Maintenance due" value={upcoming.data?.length ?? 0} accent="destructive" delayMs={180} />
      </div>

      <div className="flex items-center justify-between gap-2 border-b">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="pb-1">
          {tab === 'assets' ? <NewAssetDialog /> : null}
          {tab === 'categories' ? <NewCategoryDialog /> : null}
          {tab === 'depreciation' ? <RunDepreciationDialog /> : null}
          {tab === 'maintenance' ? <NewMaintenanceDialog /> : null}
        </div>
      </div>

      {tab === 'assets' ? (
        <Table empty="No assets yet." rows={list} cols={['Asset', 'Name', 'Category', 'Cost', 'Book value', 'Status']} render={(a: Asset) => (
          <tr key={a.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpenAsset(a.id)}>
            <Td className="font-medium">{a.assetNo}</Td>
            <Td>{a.name}</Td>
            <Td>{a.categoryName ?? '—'}</Td>
            <Td className="tabular-nums">{formatMoney(a.acquisitionCost.amountMinor, a.acquisitionCost.currency)}</Td>
            <Td className="tabular-nums">{formatMoney(a.bookValue.amountMinor, a.bookValue.currency)}</Td>
            <Td><Badge variant={STATUS_VARIANT[a.status] ?? 'outline'}>{a.status}</Badge></Td>
          </tr>
        )} />
      ) : null}

      {tab === 'categories' ? (
        <Table empty="No categories yet." rows={categories.data ?? []} cols={['Name', 'Code', 'Method', 'Life (mo)', 'Salvage %', 'Status']} render={(c: AssetCategory) => (
          <tr key={c.id} className="border-t">
            <Td className="font-medium">{c.name}</Td>
            <Td>{c.code ?? '—'}</Td>
            <Td className="capitalize">{c.method.replace('_', ' ').toLowerCase()}</Td>
            <Td>{c.usefulLifeMonths}</Td>
            <Td>{c.salvagePct}%</Td>
            <Td><Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>{c.status}</Badge></Td>
          </tr>
        )} />
      ) : null}

      {tab === 'depreciation' ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border">
            <div className="border-b bg-muted/40 px-4 py-2 text-sm font-medium">Asset register by category</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Category</th><th className="px-4 py-2">Assets</th><th className="px-4 py-2">Cost</th><th className="px-4 py-2">Accumulated</th><th className="px-4 py-2">Net book value</th></tr></thead>
              <tbody>
                {reg.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No assets.</td></tr> :
                  reg.map((r) => (
                    <tr key={r.category} className="border-t">
                      <Td className="font-medium">{r.category}</Td>
                      <Td>{r.count}</Td>
                      <Td className="tabular-nums">{formatMoney(r.cost.amountMinor, r.cost.currency)}</Td>
                      <Td className="tabular-nums">{formatMoney(r.accumulated.amountMinor, r.accumulated.currency)}</Td>
                      <Td className="tabular-nums font-medium">{formatMoney(r.bookValue.amountMinor, r.bookValue.currency)}</Td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Table empty="No depreciation runs yet." rows={runs.data ?? []} cols={['Run', 'Period', 'Assets', 'Amount']} render={(r: AssetDepreciationRun) => (
            <tr key={r.id} className="border-t">
              <Td className="font-medium">{r.runNo}</Td>
              <Td>{r.period}</Td>
              <Td>{r.assetCount}</Td>
              <Td className="tabular-nums">{formatMoney(r.total.amountMinor, r.total.currency)}</Td>
            </tr>
          )} />
        </div>
      ) : null}

      {tab === 'maintenance' ? (
        <Table empty="No maintenance logged." rows={maintenance.data ?? []} cols={['Date', 'Asset', 'Type', 'Cost', 'Next due']} render={(mt: AssetMaintenance) => (
          <tr key={mt.id} className="border-t">
            <Td>{mt.maintDate}</Td>
            <Td className="font-medium">{mt.assetName}</Td>
            <Td>{mt.type}</Td>
            <Td className="tabular-nums">{formatMoney(mt.cost.amountMinor, mt.cost.currency)}</Td>
            <Td>{mt.nextDueDate ?? '—'}</Td>
          </tr>
        )} />
      ) : null}

      <AssetDetailDialog assetId={openAsset} open={!!openAsset} onOpenChange={(v) => !v && setOpenAsset(null)} />
    </div>
  );
}

function Table<T>({ rows, cols, render, empty }: { rows: T[]; cols: string[]; render: (r: T) => React.ReactNode; empty: string }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr>{cols.map((c, i) => <th key={i} className="px-4 py-2 font-medium">{c}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-muted-foreground"><Layers className="mx-auto mb-2 h-5 w-5" />{empty}</td></tr> : rows.map(render)}
        </tbody>
      </table>
    </div>
  );
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
