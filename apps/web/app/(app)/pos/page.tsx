'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus, Receipt, ScanLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { PosDailySummary, PosRegister, PosSale, PosShift } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CartLine {
  description: string;
  quantity: number;
  priceMajor: string;
}

const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE', 'WALLET', 'BANK'];
const toMinor = (major: string) => Math.round((Number(major) || 0) * 100);

export default function PosPage() {
  const qc = useQueryClient();
  const [registerId, setRegisterId] = useState<string>('');
  const [lines, setLines] = useState<CartLine[]>([{ description: '', quantity: 1, priceMajor: '' }]);
  const [method, setMethod] = useState('CASH');
  const [tenderMajor, setTenderMajor] = useState('');
  const [openingFloat, setOpeningFloat] = useState('');
  const [countedCash, setCountedCash] = useState('');

  const registers = useQuery({ queryKey: ['pos-registers'], queryFn: () => apiGet<PosRegister[]>('/pos/registers') });
  const reg = (registers.data ?? []).find((r) => r.id === registerId) ?? registers.data?.[0];
  const activeRegisterId = reg?.id ?? '';
  const currency = reg?.currency ?? 'PKR';

  const shift = useQuery({
    queryKey: ['pos-shift', activeRegisterId],
    queryFn: () => apiGet<PosShift | null>(`/pos/registers/${activeRegisterId}/current-shift`),
    enabled: !!activeRegisterId,
  });
  const openShift = shift.data ?? null;

  const sales = useQuery({
    queryKey: ['pos-sales', openShift?.id],
    queryFn: () => apiGet<PosSale[]>(`/pos/sales?shiftId=${openShift?.id}`),
    enabled: !!openShift?.id,
  });
  const daily = useQuery({ queryKey: ['pos-daily'], queryFn: () => apiGet<PosDailySummary>('/pos/reports/daily') });

  const totalMinor = useMemo(
    () => lines.reduce((s, l) => s + (l.quantity || 0) * toMinor(l.priceMajor), 0),
    [lines],
  );
  const changeMinor = Math.max(0, toMinor(tenderMajor) - totalMinor);

  const reset = () => {
    setLines([{ description: '', quantity: 1, priceMajor: '' }]);
    setTenderMajor('');
  };
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['pos-shift', activeRegisterId] });
    void qc.invalidateQueries({ queryKey: ['pos-sales', openShift?.id] });
    void qc.invalidateQueries({ queryKey: ['pos-daily'] });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const openMut = useMutation({
    mutationFn: () =>
      apiPost<PosShift>('/pos/shifts/open', { registerId: activeRegisterId, openingFloatMinor: toMinor(openingFloat) }),
    onSuccess: () => {
      toast.success('Shift opened');
      setOpeningFloat('');
      invalidate();
    },
    onError: fail,
  });

  const closeMut = useMutation({
    mutationFn: () => apiPost<PosShift>(`/pos/shifts/${openShift?.id}/close`, { countedCashMinor: toMinor(countedCash) }),
    onSuccess: (s) => {
      const v = s.variance?.amountMinor ?? 0;
      toast.success(`Shift closed — variance ${formatMoney(v, currency)}`);
      setCountedCash('');
      invalidate();
    },
    onError: fail,
  });

  const saleMut = useMutation({
    mutationFn: () => {
      const payable = lines
        .filter((l) => l.description.trim() && toMinor(l.priceMajor) >= 0)
        .map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitPriceMinor: toMinor(l.priceMajor) }));
      const tendered = tenderMajor ? toMinor(tenderMajor) : totalMinor;
      return apiPost<PosSale>('/pos/sales', {
        registerId: activeRegisterId,
        shiftId: openShift?.id,
        lines: payable,
        payments: [{ method, amountMinor: tendered }],
      });
    },
    onSuccess: (s) => {
      toast.success(`${s.saleNo} — change ${formatMoney(s.change.amountMinor, currency)}`);
      reset();
      invalidate();
    },
    onError: fail,
  });

  const canSell = !!openShift && lines.some((l) => l.description.trim() && toMinor(l.priceMajor) > 0);

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Point of Sale" description="Ring up sales, manage cashier shifts, and reconcile the drawer." />

      {registers.data && registers.data.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No registers yet. An administrator can create one via <code>POST /pos/registers</code>.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Receipt} label="Sales today" value={daily.data?.saleCount ?? 0} accent="primary" delayMs={0} />
        <StatCard
          icon={Banknote}
          label="Net sales today"
          value={daily.data?.netSalesMinor ?? 0}
          format={(v) => formatMoney(v, currency)}
          accent="success"
          delayMs={60}
        />
        <StatCard icon={Receipt} label="Returns today" value={daily.data?.returnCount ?? 0} accent="warning" delayMs={120} />
        <StatCard
          icon={ScanLine}
          label="Gross margin today"
          value={daily.data?.grossMarginMinor ?? 0}
          format={(v) => formatMoney(v, currency)}
          accent="primary"
          delayMs={180}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label>Register</Label>
          <Select value={activeRegisterId} onValueChange={setRegisterId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select register" />
            </SelectTrigger>
            <SelectContent>
              {(registers.data ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} {r.status !== 'ACTIVE' ? '(inactive)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {openShift ? (
          <Badge variant="outline" className="h-9 px-3">
            Shift {openShift.shiftNo} · open
          </Badge>
        ) : null}
      </div>

      {!openShift ? (
        <Card>
          <CardHeader>
            <CardTitle>Open a shift</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label>Opening float ({currency})</Label>
              <Input
                className="w-40"
                inputMode="decimal"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <Button onClick={() => openMut.mutate()} disabled={!activeRegisterId || openMut.isPending}>
              Open shift
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Cart */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>New sale</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines((ls) => [...ls, { description: '', quantity: 1, priceMajor: '' }])}
              >
                <Plus className="mr-1 h-4 w-4" /> Add line
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="grid flex-1 gap-1">
                    {i === 0 ? <Label className="text-xs">Item</Label> : null}
                    <Input
                      value={l.description}
                      placeholder="Item / product name"
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                    />
                  </div>
                  <div className="grid w-20 gap-1">
                    {i === 0 ? <Label className="text-xs">Qty</Label> : null}
                    <Input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))
                      }
                    />
                  </div>
                  <div className="grid w-28 gap-1">
                    {i === 0 ? <Label className="text-xs">Price</Label> : null}
                    <Input
                      inputMode="decimal"
                      value={l.priceMajor}
                      placeholder="0.00"
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, priceMajor: e.target.value } : x)))}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Tender */}
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="text-lg font-semibold">{formatMoney(totalMinor, currency)}</span>
              </div>
              <div className="grid gap-1">
                <Label>Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label>Tendered ({currency})</Label>
                <Input
                  inputMode="decimal"
                  value={tenderMajor}
                  placeholder={(totalMinor / 100).toFixed(2)}
                  onChange={(e) => setTenderMajor(e.target.value)}
                />
              </div>
              {method === 'CASH' && tenderMajor ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Change</span>
                  <span className="font-medium text-success">{formatMoney(changeMinor, currency)}</span>
                </div>
              ) : null}
              <Button className="w-full" disabled={!canSell || saleMut.isPending} onClick={() => saleMut.mutate()}>
                Complete sale · {formatMoney(totalMinor, currency)}
              </Button>

              <div className="border-t pt-3">
                <Label>Close shift — counted cash ({currency})</Label>
                <div className="mt-1 flex gap-2">
                  <Input inputMode="decimal" value={countedCash} placeholder="0.00" onChange={(e) => setCountedCash(e.target.value)} />
                  <Button variant="outline" disabled={!countedCash || closeMut.isPending} onClick={() => closeMut.mutate()}>
                    Close
                  </Button>
                </div>
                {openShift.report ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {openShift.report.saleCount} sales · cash {formatMoney(openShift.report.cashSalesMinor, currency)}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent sales */}
      {openShift ? (
        <Card>
          <CardHeader>
            <CardTitle>This shift</CardTitle>
          </CardHeader>
          <CardContent>
            {sales.data && sales.data.length > 0 ? (
              <div className="divide-y text-sm">
                {sales.data.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.saleNo}</span>
                      <Badge variant={s.type === 'RETURN' ? 'destructive' : 'outline'}>{s.status}</Badge>
                    </div>
                    <span className="font-medium">{formatMoney(s.total.amountMinor, currency)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">No sales in this shift yet.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
