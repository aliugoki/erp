'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { PriceTiersCard } from '@/components/pharmacy/price-tiers';
import {
  DRUG_FORMS,
  DRUG_SCHEDULES,
  ExpiryBadge,
  ScheduleBadge,
  Spinner,
  type DrugDetailData,
  type Lot,
} from '@/components/pharmacy/pharm-ui';

interface Form {
  genericName: string;
  brand: string;
  manufacturer: string;
  strength: string;
  form: string;
  packSize: string;
  schedule: string;
  rxRequired: boolean;
  controlled: boolean;
  therapeuticCategory: string;
  barcode: string;
  reorderLevel: string;
  maxLevel: string;
  storage: string;
  status: string;
}

function toForm(d: DrugDetailData): Form {
  return {
    genericName: d.genericName ?? '',
    brand: d.brand ?? '',
    manufacturer: d.manufacturer ?? '',
    strength: d.strength ?? '',
    form: d.form,
    packSize: String(d.packSize),
    schedule: d.schedule,
    rxRequired: d.rxRequired,
    controlled: d.controlled,
    therapeuticCategory: d.therapeuticCategory ?? '',
    barcode: d.barcode ?? '',
    reorderLevel: String(d.reorderLevel),
    maxLevel: d.maxLevel == null ? '' : String(d.maxLevel),
    storage: d.storage,
    status: d.status,
  };
}

export function DrugDetail({ id, onBack, onDeleted }: { id: string; onBack: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const drugQ = useQuery({ queryKey: ['pharm-drug', id], queryFn: () => apiGet<DrugDetailData>(`/pharmacy/drugs/${id}`) });
  const drug = drugQ.data;
  const lotsQ = useQuery({
    queryKey: ['pharm-lots', id],
    queryFn: () => apiGet<Lot[]>(`/pharmacy/stock/lots?productId=${drug!.productId}`),
    enabled: !!drug,
  });

  const [f, setF] = useState<Form | null>(null);
  const form = f ?? (drug ? toForm(drug) : null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...(s ?? toForm(drug!)), [k]: v }));

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const save = useMutation({
    mutationFn: () => {
      const cur = form!;
      return apiPatch(`/pharmacy/drugs/${id}`, {
        genericName: cur.genericName || null,
        brand: cur.brand || null,
        manufacturer: cur.manufacturer || null,
        strength: cur.strength || null,
        form: cur.form,
        packSize: Number(cur.packSize) || 1,
        schedule: cur.schedule,
        rxRequired: cur.rxRequired,
        controlled: cur.controlled,
        therapeuticCategory: cur.therapeuticCategory || null,
        barcode: cur.barcode || null,
        reorderLevel: Number(cur.reorderLevel) || 0,
        maxLevel: cur.maxLevel === '' ? null : Number(cur.maxLevel),
        storage: cur.storage,
        status: cur.status,
      });
    },
    onSuccess: () => {
      toast.success('Drug saved');
      void qc.invalidateQueries({ queryKey: ['pharm-drug', id] });
      void qc.invalidateQueries({ queryKey: ['pharm-drugs'] });
    },
    onError: onErr,
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/pharmacy/drugs/${id}`),
    onSuccess: () => {
      toast.success('Drug deleted');
      void qc.invalidateQueries({ queryKey: ['pharm-drugs'] });
      onDeleted();
    },
    onError: onErr,
  });

  if (drugQ.isLoading) return <Spinner />;
  if (drugQ.isError || !drug || !form) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Drug not found.</div>;

  const lots = lotsQ.data ?? [];

  return (
    <>
      <PaneHeader>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{drug.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{drug.sku}</span>
          <ScheduleBadge schedule={drug.schedule} />
        </div>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this drug?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="On hand" value={`${drug.onHand}`} tone={drug.belowReorder ? 'amber' : 'default'} />
          <Tile label="Sell price" value={formatMoney(drug.sellPrice.amountMinor, drug.sellPrice.currency)} />
          <Tile label="Cost price" value={formatMoney(drug.costPrice.amountMinor, drug.costPrice.currency)} />
          <Tile label="Stock value" value={formatMoney(drug.stockValue.amountMinor, drug.stockValue.currency)} />
        </div>

        <section className="grid max-w-3xl grid-cols-2 gap-4">
          <Field label="Generic name"><Input value={form.genericName} onChange={(e) => set('genericName', e.target.value)} /></Field>
          <Field label="Brand"><Input value={form.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label="Manufacturer"><Input value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></Field>
          <Field label="Strength"><Input value={form.strength} onChange={(e) => set('strength', e.target.value)} /></Field>
          <Field label="Form">
            <Select value={form.form} onValueChange={(v) => set('form', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DRUG_FORMS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Pack size"><Input value={form.packSize} onChange={(e) => set('packSize', e.target.value)} type="number" min={1} /></Field>
          <Field label="Schedule">
            <Select value={form.schedule} onValueChange={(v) => set('schedule', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DRUG_SCHEDULES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Therapeutic category"><Input value={form.therapeuticCategory} onChange={(e) => set('therapeuticCategory', e.target.value)} /></Field>
          <Field label="Barcode"><Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
          <Field label="Reorder level"><Input value={form.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} type="number" min={0} /></Field>
          <Field label="Max level"><Input value={form.maxLevel} onChange={(e) => set('maxLevel', e.target.value)} type="number" min={0} /></Field>
          <Field label="Storage" className="col-span-2"><Input value={form.storage} onChange={(e) => set('storage', e.target.value)} /></Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set('status', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ACTIVE">ACTIVE</SelectItem><SelectItem value="INACTIVE">INACTIVE</SelectItem></SelectContent>
            </Select>
          </Field>
          <div className="col-span-2 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.rxRequired} onCheckedChange={(v) => set('rxRequired', v)} /><span className="text-muted-foreground">Rx required</span></label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.controlled} onCheckedChange={(v) => set('controlled', v)} /><span className="text-muted-foreground">Controlled</span></label>
          </div>
          <div className="col-span-2"><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Batches</h3>
          {lotsQ.isLoading ? (
            <Spinner />
          ) : (
            <div className="space-y-1.5">
              {lots.map((lot) => (
                <div key={lot.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{lot.lotNo}</span>
                  <ExpiryBadge expiryDate={lot.expiryDate} />
                  <span className="text-xs">{lot.qtyOnHand}</span>
                  <span className="text-xs text-muted-foreground">{formatMoney(lot.value.amountMinor, lot.value.currency)}</span>
                </div>
              ))}
              {lots.length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">No batches.</p> : null}
            </div>
          )}
        </section>

        <PriceTiersCard productId={drug.productId} currency={drug.currency} />
      </PaneBody>
    </>
  );
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${tone === 'amber' ? 'text-amber-600' : ''}`}>{value}</p></div>;
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`grid gap-1 text-sm ${className ?? ''}`}><Label className="text-muted-foreground">{label}</Label>{children}</div>;
}
