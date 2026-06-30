'use client';
import { ModuleTitle } from '@/components/module-title';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Clock, Loader2, Monitor, Receipt, Search, Settings, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { PosRegister, PosSale, PosShift } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { PosBadge, fmtDateTime } from '@/components/pos/pos-ui';
import { RegisterDetail } from '@/components/pos/register-detail';
import { ShiftDetail } from '@/components/pos/shift-detail';
import { SaleDetail } from '@/components/pos/sale-detail';
import { PosReports } from '@/components/pos/pos-reports';
import { BrandingCard } from '@/components/pos/branding-card';
import { NewRegisterDialog } from '@/components/pos/new-register-dialog';
import { Input } from '@/components/ui/input';

type Section = 'registers' | 'shifts' | 'sales' | 'reports' | 'settings';

export default function PosManagePage() {
  const [section, setSection] = useState<Section>('registers');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const registers = useQuery({ queryKey: ['pos-registers'], queryFn: () => apiGet<PosRegister[]>('/pos/registers') });
  const shifts = useQuery({ queryKey: ['pos-shifts'], queryFn: () => apiGet<PosShift[]>('/pos/shifts'), enabled: section === 'shifts' });
  const sales = useQuery({ queryKey: ['pos-sales-all'], queryFn: () => apiGet<PosSale[]>('/pos/sales'), enabled: section === 'sales' });

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); };
  const clear = () => setSel(null);
  const fullPane = section === 'reports' || section === 'settings';
  const showDetail = !!sel || fullPane;
  const regName = new Map((registers.data ?? []).map((r) => [r.id, r.name]));
  const saleList = (sales.data ?? []).filter((s) => !q || `${s.saleNo} ${s.customerName ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={Monitor} label="Registers" count={registers.data?.length} active={section === 'registers'} onClick={() => pick('registers')} />
      <RailItem icon={Clock} label="Shifts" active={section === 'shifts'} onClick={() => pick('shifts')} tone="sky" />
      <RailItem icon={Receipt} label="Sales" active={section === 'sales'} onClick={() => pick('sales')} tone="emerald" />
      <div className="my-1 border-t" />
      <RailItem icon={BarChart3} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="violet" />
      <RailItem icon={Settings} label="Settings" active={section === 'settings'} onClick={() => pick('settings')} />
    </div>
  );

  const list = (
    <Pane>
      {section === 'registers' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Registers</span><NewRegisterDialog /></PaneHeader>
          <PaneBody>
            {registers.isLoading ? <Spinner /> : (registers.data ?? []).length === 0 ? <Hint>No registers.</Hint> : (
              <ul className="divide-y">{(registers.data ?? []).map((r) => (
                <li key={r.id}><ListRow active={sel === r.id} onClick={() => setSel(r.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.name}</div><div className="truncate text-xs text-muted-foreground">{[r.code, r.location].filter(Boolean).join(' · ') || r.currency}</div></div>
                  <PosBadge status={r.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'shifts' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Shifts</span></PaneHeader>
          <PaneBody>
            {shifts.isLoading ? <Spinner /> : (shifts.data ?? []).length === 0 ? <Hint>No shifts.</Hint> : (
              <ul className="divide-y">{(shifts.data ?? []).map((s) => (
                <li key={s.id}><ListRow active={sel === s.id} onClick={() => setSel(s.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{s.shiftNo}</div><div className="truncate text-xs text-muted-foreground">{regName.get(s.registerId) ?? ''} · {fmtDateTime(s.openedAt)}</div></div>
                  <PosBadge status={s.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'sales' ? (
        <>
          <PaneHeader><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sale #, customer…" className="h-9 w-full pl-9" /></div></PaneHeader>
          <PaneBody>
            {sales.isLoading ? <Spinner /> : saleList.length === 0 ? <Hint>No sales.</Hint> : (
              <ul className="divide-y">{saleList.map((s) => (
                <li key={s.id}><ListRow active={sel === s.id} onClick={() => setSel(s.id)}>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{s.saleNo}</span><PosBadge status={s.type} /></div><div className="truncate text-xs text-muted-foreground">{s.customerName ?? 'Walk-in'} · {fmtDateTime(s.soldAt)}</div></div>
                  <div className="flex flex-col items-end gap-1"><span className="text-xs font-semibold tabular-nums">{formatMoney(s.total.amountMinor, s.total.currency)}</span><PosBadge status={s.status} /></div>
                </ListRow></li>
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
      {section === 'registers' ? (sel ? <RegisterDetail register={(registers.data ?? []).find((r) => r.id === sel)!} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={Monitor} title="Select a register" hint="Edit terminal settings or remove a register." />)
        : section === 'shifts' ? (sel ? <ShiftDetail id={sel} onBack={clear} /> : <EmptyDetail icon={Clock} title="Select a shift" hint="Cashier shift report, variance, and close-out." />)
        : section === 'sales' ? (sel ? <SaleDetail id={sel} onBack={clear} /> : <EmptyDetail icon={Receipt} title="Select a sale" hint="Lines, tenders, void, and refund." />)
        : section === 'reports' ? <PosReports />
        : (
          <>
            <PaneHeader><span className="font-semibold">POS settings</span></PaneHeader>
            <PaneBody className="space-y-6 p-5">
              <BrandingCard />
              <GlAccountsCard
                title="POS → general ledger"
                description="When set, each completed sale posts Dr clearing; Cr revenue (+ tax), and Dr COGS / Cr inventory. Requires background reactions enabled."
                getPath="/pos/gl-config" putPath="/pos/gl-config" queryKey="pos-gl-config"
                slots={[
                  { key: 'clearingAccountId', label: 'Clearing / cash (Dr)', required: true },
                  { key: 'revenueAccountId', label: 'Sales revenue (Cr)', types: ['REVENUE'], required: true },
                  { key: 'taxAccountId', label: 'Tax payable (Cr)', types: ['LIABILITY'] },
                  { key: 'cogsAccountId', label: 'COGS (Dr)', types: ['EXPENSE'] },
                  { key: 'inventoryAccountId', label: 'Inventory (Cr)', types: ['ASSET'] },
                ]}
              />
            </PaneBody>
          </>
        )}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <ModuleTitle>POS Back-office</ModuleTitle>
          <p className="text-sm text-muted-foreground">Registers, shift reconciliation, sales history, and reports.</p>
        </div>
        <Link href="/pos" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"><ArrowLeft className="h-4 w-4" /> Back to till</Link>
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }
