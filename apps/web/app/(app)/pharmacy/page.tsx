'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarClock, ClipboardList, FlaskConical, Layers, Pill, Receipt, Search, Settings2, ShieldAlert, SlidersHorizontal, Wallet,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import {
  type ControlledRow, type DispenseRow, DISPENSE_LABEL, type DrugListItem, ExpiryBadge, Hint, type Lot,
  ScheduleBadge, Spinner, StatusBadge, fmtDate,
} from '@/components/pharmacy/pharm-ui';
import { NewDrugDialog } from '@/components/pharmacy/new-drug-dialog';
import { DrugDetail } from '@/components/pharmacy/drug-detail';
import { ReceiveBatchDialog } from '@/components/pharmacy/receive-batch-dialog';
import { DispenseCounter } from '@/components/pharmacy/dispense-counter';
import { DispenseDetail } from '@/components/pharmacy/dispense-detail';
import { PharmacySettings } from '@/components/pharmacy/pharmacy-settings';
import { AdjustmentsList, LotActions } from '@/components/pharmacy/adjustments';

type Section = 'drugs' | 'dispense' | 'dispenses' | 'batches' | 'controlled' | 'adjustments' | 'reports' | 'settings';

export default function PharmacyPage() {
  const [section, setSection] = useState<Section>('drugs');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const drugs = useQuery({ queryKey: ['pharm-drugs'], queryFn: () => apiGet<DrugListItem[]>('/pharmacy/drugs') });
  const lots = useQuery({ queryKey: ['pharm-lots'], queryFn: () => apiGet<Lot[]>('/pharmacy/stock/lots'), enabled: section === 'batches' });
  const dispenses = useQuery({ queryKey: ['pharm-dispenses'], queryFn: () => apiGet<DispenseRow[]>('/pharmacy/dispenses'), enabled: section === 'dispenses' });
  const controlled = useQuery({ queryKey: ['pharm-controlled'], queryFn: () => apiGet<ControlledRow[]>('/pharmacy/reports/controlled'), enabled: section === 'controlled' });
  const nearExpiry = useQuery({ queryKey: ['pharm-near-expiry'], queryFn: () => apiGet<Lot[]>('/pharmacy/reports/near-expiry?days=90'), enabled: section === 'reports' || section === 'drugs' });

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); };
  const clear = () => setSel(null);

  const drugList = useMemo(
    () => (drugs.data ?? []).filter((d) => !q || [d.name, d.sku, d.genericName, d.brand].some((x) => x?.toLowerCase().includes(q.toLowerCase()))),
    [drugs.data, q],
  );
  const lowCount = (drugs.data ?? []).filter((d) => d.belowReorder).length;
  const controlledCount = (drugs.data ?? []).filter((d) => d.controlled).length;
  const expiringCount = nearExpiry.data?.length ?? 0;

  const showDetail = !!sel || section === 'dispense' || section === 'reports' || section === 'settings';

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={Pill} label="Drug master" count={drugs.data?.length} active={section === 'drugs'} onClick={() => pick('drugs')} />
      <RailItem icon={Receipt} label="Dispense" active={section === 'dispense'} onClick={() => pick('dispense')} tone="emerald" />
      <RailItem icon={ClipboardList} label="Dispense history" active={section === 'dispenses'} onClick={() => pick('dispenses')} tone="sky" />
      <div className="my-1 border-t" />
      <RailItem icon={Layers} label="Batches & expiry" active={section === 'batches'} onClick={() => pick('batches')} tone="amber" />
      <RailItem icon={ShieldAlert} label="Controlled register" count={controlledCount} active={section === 'controlled'} onClick={() => pick('controlled')} tone="rose" />
      <RailItem icon={SlidersHorizontal} label="Adjustments" active={section === 'adjustments'} onClick={() => pick('adjustments')} tone="amber" />
      <div className="my-1 border-t" />
      <RailItem icon={Wallet} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="violet" />
      <RailItem icon={Settings2} label="Settings" active={section === 'settings'} onClick={() => pick('settings')} />
    </div>
  );

  const list = (
    <Pane>
      {section === 'drugs' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drugs…" className="h-9 w-full pl-9" /></div>
            <ReceiveBatchDialog />
            <NewDrugDialog />
          </PaneHeader>
          <PaneBody>
            {drugs.isLoading ? <Spinner /> : drugList.length === 0 ? <Hint>No drugs yet. Add one to begin.</Hint> : (
              <ul className="divide-y">{drugList.map((d) => (
                <li key={d.id}><ListRow active={sel === d.id} onClick={() => setSel(d.id)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate font-medium">{d.name}</span>{d.controlled ? <ShieldAlert className="h-3.5 w-3.5 text-rose-500" /> : null}{d.belowReorder ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : null}</div>
                    <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">{d.strength ? `${d.strength} · ` : ''}{d.form} <ScheduleBadge schedule={d.schedule} /></div>
                  </div>
                  <div className="text-right text-xs"><div className={`font-semibold tabular-nums ${d.belowReorder ? 'text-amber-600' : ''}`}>{d.onHand}</div><div className="text-muted-foreground">{formatMoney(d.sellPrice.amountMinor, d.sellPrice.currency)}</div></div>
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'dispenses' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Dispenses</span></PaneHeader>
          <PaneBody>
            {dispenses.isLoading ? <Spinner /> : (dispenses.data ?? []).length === 0 ? <Hint>No dispenses yet.</Hint> : (
              <ul className="divide-y">{(dispenses.data ?? []).map((d) => (
                <li key={d.id}><ListRow active={sel === d.id} onClick={() => setSel(d.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{d.dispense_no}</div><div className="truncate text-xs text-muted-foreground">{DISPENSE_LABEL[d.type] ?? d.type} · {d.customer ?? d.patient_ref ?? d.payment_method} · {fmtDate(d.occurred_on)}</div></div>
                  <div className="flex flex-col items-end gap-1"><span className="text-sm font-semibold tabular-nums">{formatMoney(d.total_minor, d.currency)}</span><StatusBadge status={d.status} /></div>
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'batches' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Stock lots</span><ReceiveBatchDialog /></PaneHeader>
          <PaneBody>
            {lots.isLoading ? <Spinner /> : (lots.data ?? []).length === 0 ? <Hint>No stock lots. Receive a batch.</Hint> : (
              <ul className="divide-y">{(lots.data ?? []).map((l) => (
                <li key={l.id}><ListRow active={sel === l.id} onClick={() => setSel(l.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{l.name}</div><div className="truncate text-xs text-muted-foreground">Lot {l.lotNo} · {l.qtyOnHand} units · {formatMoney(l.value.amountMinor, l.value.currency)}</div></div>
                  <ExpiryBadge expiryDate={l.expiryDate} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'controlled' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Controlled-substance register</span></PaneHeader>
          <PaneBody>
            {controlled.isLoading ? <Spinner /> : (controlled.data ?? []).length === 0 ? <Hint>No controlled-drug movements recorded.</Hint> : (
              <ul className="divide-y">{(controlled.data ?? []).map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.direction === 'OUT' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.direction === 'OUT' ? `−${r.qty}` : `+${r.qty}`}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {r.schedule ? <ScheduleBadge schedule={r.schedule} /> : null}
                    <span>bal {r.balance_after}</span>{r.dispense_no ? <span>· {r.dispense_no}</span> : null}
                    {r.prescriber ? <span>· Rx {r.prescriber}</span> : null}<span>· {fmtDate(r.occurred_on)}</span>
                  </div>
                </li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'adjustments' ? (
        <AdjustmentsList />
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium">{section === 'dispense' ? 'Dispensing counter' : section === 'reports' ? 'Analytics' : 'Configuration'}</span></PaneHeader>
          <PaneBody className="p-2">
            {section === 'reports' ? (
              <div className="space-y-1">
                <ListRow active><Wallet className="h-4 w-4 text-violet-600" /><span className="flex-1 font-medium">Stock & expiry analytics</span></ListRow>
              </div>
            ) : section === 'settings' ? (
              <div className="space-y-1"><ListRow active><Settings2 className="h-4 w-4 text-primary" /><span className="flex-1 font-medium">Mode, policies & GL accounts</span></ListRow></div>
            ) : (
              <p className="px-3 py-6 text-sm text-muted-foreground">Build the cart on the right, then complete the dispense — stock is consumed FEFO and posted to the ledger.</p>
            )}
          </PaneBody>
        </>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'drugs' ? (sel ? <DrugDetail id={sel} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={Pill} title="Select a drug" hint="Edit drug master data, view stock value, batches and pricing." />)
        : section === 'dispense' ? <DispenseCounter onDone={() => pick('dispenses')} />
        : section === 'dispenses' ? (sel ? <DispenseDetail id={sel} onBack={clear} /> : <EmptyDetail icon={Receipt} title="Select a dispense" hint="View the priced lines, lots consumed, and post a return." />)
        : section === 'batches' ? (sel ? <LotDetail lot={(lots.data ?? []).find((l) => l.id === sel)} /> : <EmptyDetail icon={Layers} title="Batch & expiry" hint="Receive batches with lot numbers + expiry; dispensing consumes them first-expiry-first-out." />)
        : section === 'controlled' ? <EmptyDetail icon={ShieldAlert} title="Controlled register" hint="An immutable audit of every controlled/narcotic movement — dispense out, return in." />
        : section === 'adjustments' ? <EmptyDetail icon={SlidersHorizontal} title="Stock adjustments" hint="Return-to-vendor, write-offs and corrections — each values through the ledger and posts to the GL. Open a batch under ‘Batches & expiry’ for per-lot actions." />
        : section === 'reports' ? <PharmacyReports nearExpiry={nearExpiry.data ?? []} /> : <PharmacySettings />}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><FlaskConical className="h-6 w-6 text-primary" /> Pharmacy</h1>
        <p className="text-sm text-muted-foreground">Drug master, batch + expiry (FEFO) stock, dispensing, and the controlled-substance register.</p>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Drugs" value={drugs.data ? String(drugs.data.length) : '—'} icon={Pill} />
        <Kpi label="Below reorder" value={String(lowCount)} icon={AlertTriangle} tone={lowCount > 0 ? 'amber' : 'default'} />
        <Kpi label="Expiring ≤90d" value={String(expiringCount)} icon={CalendarClock} tone={expiringCount > 0 ? 'rose' : 'default'} />
        <Kpi label="Controlled" value={String(controlledCount)} icon={ShieldAlert} tone="sky" />
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

function LotDetail({ lot }: { lot?: Lot }) {
  if (!lot) return <EmptyDetail icon={Layers} title="Lot" hint="Select a lot." />;
  return (
    <>
      <PaneHeader><span className="flex-1 truncate font-semibold">{lot.name}</span><ExpiryBadge expiryDate={lot.expiryDate} /></PaneHeader>
      <PaneBody className="p-5">
        <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
          <Field label="Lot number" value={lot.lotNo} />
          <Field label="SKU" value={lot.sku} />
          <Field label="On hand" value={`${lot.qtyOnHand} units`} />
          <Field label="Unit cost" value={formatMoney(lot.unitCost.amountMinor, lot.unitCost.currency)} />
          <Field label="Lot value" value={formatMoney(lot.value.amountMinor, lot.value.currency)} />
          <Field label="Received" value={fmtDate(lot.receivedOn)} />
          <Field label="Expiry" value={fmtDate(lot.expiryDate)} />
          <Field label="Receipt" value={lot.docNo ?? '—'} />
        </dl>
        <div className="max-w-md"><LotActions lot={lot} /></div>
      </PaneBody>
    </>
  );
}

function PharmacyReports({ nearExpiry }: { nearExpiry: Lot[] }) {
  const value = nearExpiry.reduce((s, l) => s + l.value.amountMinor, 0);
  return (
    <>
      <PaneHeader><span className="flex-1 font-semibold">Stock & expiry analytics</span></PaneHeader>
      <PaneBody className="p-5">
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Lots expiring ≤90d</p><p className="mt-1 text-2xl font-bold tabular-nums">{nearExpiry.length}</p></div>
          <div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Value at risk</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(value)}</p></div>
        </div>
        <h3 className="mb-2 text-sm font-semibold">Soonest to expire</h3>
        {nearExpiry.length === 0 ? <Hint>Nothing expiring in the next 90 days.</Hint> : (
          <ul className="divide-y rounded-xl border">{nearExpiry.slice(0, 30).map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <div className="min-w-0"><div className="truncate font-medium">{l.name}</div><div className="truncate text-xs text-muted-foreground">Lot {l.lotNo} · {l.qtyOnHand} units</div></div>
              <ExpiryBadge expiryDate={l.expiryDate} />
            </li>
          ))}</ul>
        )}
      </PaneBody>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

function Kpi({ label, value, icon: Icon, tone = 'default' }: { label: string; value: string; icon: typeof Pill; tone?: 'default' | 'amber' | 'emerald' | 'sky' | 'rose' }) {
  const tones: Record<string, string> = { default: 'text-primary', amber: 'text-amber-600', emerald: 'text-emerald-600', sky: 'text-sky-600', rose: 'text-rose-600' };
  return <div className="rounded-xl border p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tones[tone]}`} /></div><p className="mt-2 text-xl font-bold tabular-nums">{value}</p></div>;
}
