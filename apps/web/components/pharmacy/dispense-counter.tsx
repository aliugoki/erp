'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, ShoppingCart, Check } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { formatMoney } from '@/lib/utils';
import { type DrugListItem, DISPENSE_TYPES, DISPENSE_LABEL, PAYMENT_METHODS, Spinner } from '@/components/pharmacy/pharm-ui';

interface CartLine {
  key: string;
  productId: string;
  qty: number;
  unitPriceMajor: number;
  discountMajor: number;
  taxBp: number;
}

interface DispenseForm {
  type: string;
  paymentMethod: string;
  patientRef: string;
  prescriber: string;
  prescriptionRef: string;
  insurer: string;
  insuranceCoverMajor: number;
}

interface DispenseItemPayload {
  productId: string;
  qty: number;
  unitPriceMinor: number;
  discountMinor?: number;
  taxBp?: number;
}

const EMPTY_FORM: DispenseForm = {
  type: 'RETAIL_SALE',
  paymentMethod: 'CASH',
  patientRef: '',
  prescriber: '',
  prescriptionRef: '',
  insurer: '',
  insuranceCoverMajor: 0,
};

let lineSeq = 0;
const newLine = (): CartLine => ({ key: `l${++lineSeq}`, productId: '', qty: 1, unitPriceMajor: 0, discountMajor: 0, taxBp: 0 });

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const num = (v: string) => (v === '' ? 0 : Number(v));

export function DispenseCounter({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const drugs = useQuery({ queryKey: ['pharm-drugs'], queryFn: () => apiGet<DrugListItem[]>('/pharmacy/drugs') });
  const [form, setForm] = useState<DispenseForm>(EMPTY_FORM);
  const [lines, setLines] = useState<CartLine[]>([newLine()]);

  const drugList = drugs.data ?? [];
  const drugById = useMemo(() => new Map(drugList.map((d) => [d.productId, d])), [drugList]);

  const setF = <K extends keyof DispenseForm>(k: K, v: DispenseForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const patchLine = (key: string, patch: Partial<CartLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const addLine = () => setLines((ls) => [...ls, newLine()]);

  const pickDrug = (key: string, productId: string) => {
    const d = drugById.get(productId);
    patchLine(key, { productId, unitPriceMajor: d ? d.sellPrice.amountMinor / 100 : 0 });
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    const perLine = lines.map((l) => {
      const gross = l.qty * Math.round(l.unitPriceMajor * 100);
      const disc = clamp(Math.round(l.discountMajor * 100), 0, gross);
      const taxable = gross - disc;
      const lineTax = Math.floor((taxable * l.taxBp) / 10000);
      const lineTotal = taxable + lineTax;
      subtotal += gross;
      discount += disc;
      tax += lineTax;
      return { gross, disc, lineTax, lineTotal };
    });
    return { perLine, subtotal, discount, tax, total: subtotal - discount + tax };
  }, [lines]);

  const valid = lines.length > 0 && lines.every((l) => l.productId && l.qty >= 1);

  const dispense = useMutation({
    mutationFn: () => {
      const items: DispenseItemPayload[] = lines.map((l) => {
        const item: DispenseItemPayload = { productId: l.productId, qty: l.qty, unitPriceMinor: Math.round(l.unitPriceMajor * 100) };
        if (l.discountMajor > 0) item.discountMinor = Math.round(l.discountMajor * 100);
        if (l.taxBp > 0) item.taxBp = l.taxBp;
        return item;
      });
      const isInsurance = form.paymentMethod === 'INSURANCE';
      const body: Record<string, unknown> = { type: form.type, paymentMethod: form.paymentMethod, items };
      if (form.patientRef.trim()) body.patientRef = form.patientRef.trim();
      if (form.prescriber.trim()) body.prescriber = form.prescriber.trim();
      if (form.prescriptionRef.trim()) body.prescriptionRef = form.prescriptionRef.trim();
      if (isInsurance) {
        if (form.insurer.trim()) body.insurer = form.insurer.trim();
        body.insuranceCoverMinor = Math.round(form.insuranceCoverMajor * 100);
      }
      return apiPost('/pharmacy/dispense', body);
    },
    onSuccess: (data) => {
      toast.success('Dispensed', { description: (data as { dispenseNo: string }).dispenseNo });
      void qc.invalidateQueries({ queryKey: ['pharm-dispenses'] });
      void qc.invalidateQueries({ queryKey: ['pharm-lots'] });
      void qc.invalidateQueries({ queryKey: ['pharm-drugs'] });
      void qc.invalidateQueries({ queryKey: ['pharm-near-expiry'] });
      setForm(EMPTY_FORM);
      setLines([newLine()]);
      onDone();
    },
    onError: (e) => toast.error('Could not dispense', { description: e instanceof ApiError ? e.message : '' }),
  });

  const isInsurance = form.paymentMethod === 'INSURANCE';

  return (
    <>
      <PaneHeader>
        <ShoppingCart className="h-4 w-4 text-emerald-600" />
        <span className="flex-1 text-sm font-semibold">Dispensing counter</span>
      </PaneHeader>
      <PaneBody className="flex min-h-0 flex-col">
        {/* ── Header form ─────────────────────────────────────────── */}
        <div className="grid shrink-0 grid-cols-2 gap-3 border-b p-4 md:grid-cols-3">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={form.type} onValueChange={(v) => setF('type', v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{DISPENSE_TYPES.map((t) => <SelectItem key={t} value={t}>{DISPENSE_LABEL[t] ?? t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Payment</Label>
            <Select value={form.paymentMethod} onValueChange={(v) => setF('paymentMethod', v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Patient ref</Label>
            <Input className="h-9" value={form.patientRef} onChange={(e) => setF('patientRef', e.target.value)} placeholder="optional" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Prescriber</Label>
            <Input className="h-9" value={form.prescriber} onChange={(e) => setF('prescriber', e.target.value)} placeholder="optional" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Rx ref</Label>
            <Input className="h-9" value={form.prescriptionRef} onChange={(e) => setF('prescriptionRef', e.target.value)} placeholder="optional" />
          </div>
          {isInsurance ? (
            <>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Insurer</Label>
                <Input className="h-9" value={form.insurer} onChange={(e) => setF('insurer', e.target.value)} placeholder="optional" />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Cover</Label>
                <Input className="h-9" type="number" min={0} value={form.insuranceCoverMajor} onChange={(e) => setF('insuranceCoverMajor', num(e.target.value))} />
              </div>
            </>
          ) : null}
        </div>

        {/* ── Cart lines ──────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</span>
            <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="mr-1 h-3.5 w-3.5" /> Add line</Button>
          </div>
          {drugs.isLoading ? <Spinner /> : (
            <ul className="space-y-2">
              {lines.map((l, i) => {
                const t = totals.perLine[i];
                return (
                  <li key={l.key} className="rounded-lg border bg-card p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <Select value={l.productId} onValueChange={(v) => pickDrug(l.key, v)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Select drug…" /></SelectTrigger>
                          <SelectContent>
                            {drugList.map((d) => (
                              <SelectItem key={d.productId} value={d.productId}>
                                {d.name}{d.strength ? ` ${d.strength}` : ''} · {formatMoney(d.sellPrice.amountMinor, d.sellPrice.currency)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-rose-600" onClick={() => removeLine(l.key)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="grid gap-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">Qty</Label>
                        <Input className="h-8 tabular-nums" type="number" min={1} value={l.qty} onChange={(e) => patchLine(l.key, { qty: Math.max(1, Math.round(num(e.target.value))) })} />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">Unit price</Label>
                        <Input className="h-8 tabular-nums" type="number" min={0} step="0.01" value={l.unitPriceMajor} onChange={(e) => patchLine(l.key, { unitPriceMajor: num(e.target.value) })} />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">Discount</Label>
                        <Input className="h-8 tabular-nums" type="number" min={0} step="0.01" value={l.discountMajor} onChange={(e) => patchLine(l.key, { discountMajor: num(e.target.value) })} />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">Tax (bp)</Label>
                        <Input className="h-8 tabular-nums" type="number" min={0} value={l.taxBp} onChange={(e) => patchLine(l.key, { taxBp: Math.max(0, Math.round(num(e.target.value))) })} />
                      </div>
                    </div>
                    <div className="mt-1.5 text-right text-xs text-muted-foreground tabular-nums">Line total {formatMoney(t?.lineTotal ?? 0)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Totals + submit ─────────────────────────────────────── */}
        <div className="shrink-0 border-t bg-muted/30 p-4">
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatMoney(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">-{formatMoney(totals.discount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{formatMoney(totals.tax)}</span></div>
            <div className="mt-1 flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span className="tabular-nums">{formatMoney(totals.total)}</span></div>
          </div>
          <Button
            className="mt-3 w-full bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!valid || dispense.isPending}
            onClick={() => dispense.mutate()}
          >
            {dispense.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} Complete dispense
          </Button>
        </div>
      </PaneBody>
    </>
  );
}
