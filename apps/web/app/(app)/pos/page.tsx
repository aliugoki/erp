'use client';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  Minus,
  Pause,
  Play,
  Plus,
  Receipt,
  RotateCcw,
  ScanLine,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { type CartLine, type Tender, cartTotals, nextKey } from '@/lib/pos';
import type { CrmClient, PosRegister, PosSale, PosShift, Product } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { NewRegisterDialog } from '@/components/pos/new-register-dialog';
import { PaymentDialog } from '@/components/pos/payment-dialog';
import { ReceiptDialog } from '@/components/pos/receipt-dialog';
import { ReturnDialog } from '@/components/pos/return-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const toMinorStr = (major: string) => Math.round((Number(major) || 0) * 100);

export default function PosPage() {
  const qc = useQueryClient();
  const [registerId, setRegisterId] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientId, setClientId] = useState('');
  const [orderDiscount, setOrderDiscount] = useState('');
  const [search, setSearch] = useState('');
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [openingFloat, setOpeningFloat] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<PosSale | null>(null);
  const [returnSale, setReturnSale] = useState<PosSale | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const registers = useQuery({ queryKey: ['pos-registers'], queryFn: () => apiGet<PosRegister[]>('/pos/registers') });
  const reg = (registers.data ?? []).find((r) => r.id === registerId) ?? registers.data?.[0];
  const activeRegisterId = reg?.id ?? '';
  const currency = reg?.currency ?? 'PKR';

  const shiftQ = useQuery({
    queryKey: ['pos-shift', activeRegisterId],
    queryFn: () => apiGet<PosShift | null>(`/pos/registers/${activeRegisterId}/current-shift`),
    enabled: !!activeRegisterId,
  });
  const shift = shiftQ.data ?? null;

  const products = useQuery({ queryKey: ['pos-products'], queryFn: () => apiGet<Product[]>('/inventory/products') });
  const clients = useQuery({ queryKey: ['pos-clients'], queryFn: () => apiGet<CrmClient[]>('/crm/clients') });
  const sales = useQuery({
    queryKey: ['pos-sales', shift?.id],
    queryFn: () => apiGet<PosSale[]>(`/pos/sales?shiftId=${shift?.id}`),
    enabled: !!shift?.id,
  });

  const totals = useMemo(() => cartTotals(cart, toMinorStr(orderDiscount)), [cart, orderDiscount]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.data ?? [];
    if (!q) return list.slice(0, 60);
    return list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 60);
  }, [products.data, search]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['pos-shift', activeRegisterId] });
    void qc.invalidateQueries({ queryKey: ['pos-sales', shift?.id] });
    void qc.invalidateQueries({ queryKey: ['pos-products'] });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  // ── Cart ops ────────────────────────────────────────────────────────────────
  const addProduct = (p: Product) => {
    if (resumingId) return;
    setCart((c) => {
      const i = c.findIndex((l) => l.productId === p.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...c,
        { key: nextKey(), productId: p.id, sku: p.sku, description: p.name, quantity: 1, unitPriceMinor: p.sellPrice.amountMinor, discountMinor: 0, taxRate: 0 },
      ];
    });
  };
  const setQty = (key: string, q: number) =>
    setCart((c) => c.flatMap((l) => (l.key === key ? (q <= 0 ? [] : [{ ...l, quantity: q }]) : [l])));
  const removeLine = (key: string) => setCart((c) => c.filter((l) => l.key !== key));
  const clearSale = () => {
    setCart([]);
    setClientId('');
    setOrderDiscount('');
    setResumingId(null);
  };

  const onScan = () => {
    const code = search.trim().toLowerCase();
    if (!code) return;
    const hit = (products.data ?? []).find((p) => p.sku.toLowerCase() === code);
    if (hit) {
      addProduct(hit);
      setSearch('');
      scanRef.current?.focus();
    } else {
      toast.error(`No product with SKU "${search.trim()}"`);
    }
  };

  // ── Shift ops ───────────────────────────────────────────────────────────────
  const openShift = useMutation({
    mutationFn: () => apiPost<PosShift>('/pos/shifts/open', { registerId: activeRegisterId, openingFloatMinor: toMinorStr(openingFloat) }),
    onSuccess: () => {
      toast.success('Shift opened');
      setOpeningFloat('');
      invalidate();
    },
    onError: fail,
  });
  const closeShift = useMutation({
    mutationFn: () => apiPost<PosShift>(`/pos/shifts/${shift?.id}/close`, { countedCashMinor: toMinorStr(countedCash) }),
    onSuccess: (s) => {
      toast.success(`Shift closed — variance ${formatMoney(s.variance?.amountMinor ?? 0, currency)}`);
      setCountedCash('');
      clearSale();
      invalidate();
    },
    onError: fail,
  });

  // ── Sale ops ────────────────────────────────────────────────────────────────
  const saleMut = useMutation({
    mutationFn: (tenders: Tender[]) => {
      if (resumingId) return apiPost<PosSale>(`/pos/sales/${resumingId}/complete`, { payments: tenders });
      return apiPost<PosSale>('/pos/sales', {
        registerId: activeRegisterId,
        shiftId: shift?.id,
        ...(clientId ? { clientId } : {}),
        orderDiscountMinor: toMinorStr(orderDiscount),
        lines: cart.map((l) => ({
          ...(l.productId ? { productId: l.productId } : {}),
          description: l.description,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          ...(l.discountMinor ? { discountMinor: l.discountMinor } : {}),
          ...(l.taxRate ? { taxRate: l.taxRate } : {}),
        })),
        payments: tenders,
      });
    },
    onSuccess: (sale) => {
      setPayOpen(false);
      setReceipt(sale);
      clearSale();
      invalidate();
    },
    onError: fail,
  });

  const parkMut = useMutation({
    mutationFn: () =>
      apiPost<PosSale>('/pos/sales', {
        registerId: activeRegisterId,
        shiftId: shift?.id,
        park: true,
        ...(clientId ? { clientId } : {}),
        orderDiscountMinor: toMinorStr(orderDiscount),
        lines: cart.map((l) => ({
          ...(l.productId ? { productId: l.productId } : {}),
          description: l.description,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
        })),
      }),
    onSuccess: () => {
      toast.success('Sale parked');
      clearSale();
      invalidate();
    },
    onError: fail,
  });

  const recall = async (id: string) => {
    try {
      const s = await apiGet<PosSale>(`/pos/sales/${id}`);
      setCart((s.lines ?? []).map((l) => ({
        key: nextKey(), productId: l.productId, description: l.description, quantity: l.quantity,
        unitPriceMinor: l.unitPrice.amountMinor, discountMinor: l.discount.amountMinor, taxRate: l.taxRate,
      })));
      setClientId(s.clientId ?? '');
      setResumingId(id);
    } catch (e) {
      fail(e);
    }
  };

  const voidSale = useMutation({
    mutationFn: (id: string) => apiPost<PosSale>(`/pos/sales/${id}/void`, {}),
    onSuccess: () => {
      toast.success('Sale voided — stock restored');
      invalidate();
    },
    onError: fail,
  });

  const openReceipt = async (id: string) => {
    try {
      setReceipt(await apiGet<PosSale>(`/pos/sales/${id}`));
    } catch (e) {
      fail(e);
    }
  };
  const openReturn = async (id: string) => {
    try {
      setReturnSale(await apiGet<PosSale>(`/pos/sales/${id}`));
    } catch (e) {
      fail(e);
    }
  };

  const noRegisters = registers.data && registers.data.length === 0;

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-gradient">Point of Sale</h2>
          {registers.data && registers.data.length > 0 ? (
            <Select value={activeRegisterId} onValueChange={(v) => { setRegisterId(v); clearSale(); }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Register" /></SelectTrigger>
              <SelectContent>
                {registers.data.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <NewRegisterDialog />
        </div>
        {shift ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-8 gap-1 px-3">
              <span className="size-2 rounded-full bg-success" /> {shift.shiftNo}
            </Badge>
            <div className="flex items-center gap-1">
              <Input
                className="h-8 w-28"
                inputMode="decimal"
                placeholder={`Count ${currency}`}
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
              />
              <Button size="sm" variant="outline" disabled={!countedCash || closeShift.isPending} onClick={() => closeShift.mutate()}>
                Close shift
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {noRegisters ? (
        <div className="rounded-xl border py-12 text-center text-sm text-muted-foreground">
          No registers yet. An administrator can add one in <span className="font-medium">Registers</span> (POST /pos/registers).
        </div>
      ) : !shift ? (
        <div className="mx-auto max-w-sm rounded-xl border p-6 text-center">
          <Banknote className="mx-auto mb-3 size-8 text-muted-foreground" />
          <h3 className="font-medium">Open a shift to start selling</h3>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Count the cash in the drawer and enter the opening float.</p>
          <div className="flex items-center gap-2">
            <Input inputMode="decimal" placeholder={`Opening float (${currency})`} value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />
            <Button disabled={!activeRegisterId || openShift.isPending} onClick={() => openShift.mutate()}>
              <Play className="mr-1 h-4 w-4" /> Open
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          {/* Catalogue */}
          <div className="space-y-3">
            <div className="relative">
              <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={scanRef}
                autoFocus
                className="pl-9"
                placeholder="Scan barcode / SKU, or search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onScan(); }}
              />
              {search ? (
                <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch('')} aria-label="Clear">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  disabled={!!resumingId}
                  className="group rounded-xl border p-3 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                >
                  <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{p.sku}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-semibold">{formatMoney(p.sellPrice.amountMinor, p.sellPrice.currency)}</span>
                    <Badge variant={p.onHand > 0 ? 'secondary' : 'outline'} className="text-[10px]">{p.onHand} in</Badge>
                  </div>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                  <Search className="mx-auto mb-2 h-5 w-5" /> No products match “{search}”.
                </p>
              ) : null}
            </div>
          </div>

          {/* Cart */}
          <div className="flex h-[calc(100vh-220px)] flex-col rounded-xl border">
            <div className="flex items-center justify-between gap-2 border-b p-3">
              <Select value={clientId || 'walk-in'} onValueChange={(v) => setClientId(v === 'walk-in' ? '' : v)}>
                <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk-in">Walk-in customer</SelectItem>
                  {(clients.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cart.length > 0 ? (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearSale} aria-label="Clear sale">
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            {resumingId ? (
              <div className="flex items-center justify-between bg-warning/10 px-3 py-1.5 text-xs text-warning">
                Resuming a parked sale — lines are locked.
                <button className="underline" onClick={clearSale}>Discard</button>
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto p-2">
              {cart.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                  <span>Scan or tap a product to begin.</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {cart.map((l) => {
                    const lineTotal = l.quantity * l.unitPriceMinor - l.discountMinor;
                    return (
                      <div key={l.key} className="rounded-lg px-2 py-1.5 hover:bg-muted/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{l.description}</span>
                          <span className="text-sm font-semibold tabular-nums">{formatMoney(lineTotal, currency)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Button variant="outline" size="icon" className="h-6 w-6" disabled={!!resumingId} onClick={() => setQty(l.key, l.quantity - 1)}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-7 text-center text-sm tabular-nums">{l.quantity}</span>
                            <Button variant="outline" size="icon" className="h-6 w-6" disabled={!!resumingId} onClick={() => setQty(l.key, l.quantity + 1)}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatMoney(l.unitPriceMinor, currency)} ea</span>
                          {!resumingId ? (
                            <button onClick={() => removeLine(l.key)} aria-label="Remove">
                              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                            </button>
                          ) : <span />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Totals + actions */}
            <div className="space-y-2 border-t p-3">
              {!resumingId ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Order discount</span>
                  <Input className="h-7 w-28 text-right" inputMode="decimal" placeholder="0.00" value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} />
                </div>
              ) : null}
              {totals.taxMinor > 0 ? <Line label="Tax" value={formatMoney(totals.taxMinor, currency)} /> : null}
              {totals.discountMinor > 0 ? <Line label="Discount" value={`-${formatMoney(totals.discountMinor, currency)}`} /> : null}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{totals.itemCount} item(s)</span>
                <span className="text-xl font-bold tabular-nums">{formatMoney(totals.totalMinor, currency)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={cart.length === 0 || !!resumingId || parkMut.isPending} onClick={() => parkMut.mutate()}>
                  <Pause className="mr-1 h-4 w-4" /> Park
                </Button>
                <Button disabled={cart.length === 0 || totals.totalMinor <= 0} onClick={() => setPayOpen(true)}>
                  <Banknote className="mr-1 h-4 w-4" /> Pay
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Parked + recent sales */}
      {shift ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SalesPanel
            title="Parked sales"
            empty="No parked sales."
            sales={(sales.data ?? []).filter((s) => s.status === 'PARKED')}
            currency={currency}
            render={(s) => (
              <Button size="sm" variant="outline" onClick={() => recall(s.id)} disabled={!!resumingId}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Recall
              </Button>
            )}
          />
          <SalesPanel
            title="Recent sales"
            empty="No sales in this shift yet."
            sales={(sales.data ?? []).filter((s) => s.status !== 'PARKED').slice(0, 12)}
            currency={currency}
            render={(s) => (
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Receipt" onClick={() => openReceipt(s.id)}>
                  <Receipt className="h-3.5 w-3.5" />
                </Button>
                {s.status === 'COMPLETED' && s.type === 'SALE' ? (
                  <>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Refund" onClick={() => openReturn(s.id)}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Void" onClick={() => voidSale.mutate(s.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : null}
              </div>
            )}
          />
        </div>
      ) : null}

      {reg ? (
        <PaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          registerId={activeRegisterId}
          currency={currency}
          totalMinor={totals.totalMinor}
          busy={saleMut.isPending}
          onConfirm={(tenders) => saleMut.mutate(tenders)}
        />
      ) : null}
      <ReceiptDialog open={!!receipt} onOpenChange={(v) => !v && setReceipt(null)} sale={receipt} registerName={reg?.name ?? 'POS'} />
      <ReturnDialog
        open={!!returnSale}
        onOpenChange={(v) => !v && setReturnSale(null)}
        sale={returnSale}
        onDone={(ret) => { setReturnSale(null); setReceipt(ret); invalidate(); }}
      />

      <GlAccountsCard
        title="POS → general ledger (admin)"
        description="When set, each completed sale posts Dr clearing; Cr revenue (+ tax), and Dr COGS / Cr inventory. Requires background reactions enabled."
        getPath="/pos/gl-config"
        putPath="/pos/gl-config"
        queryKey="pos-gl-config"
        slots={[
          { key: 'clearingAccountId', label: 'Clearing / cash (Dr)', required: true },
          { key: 'revenueAccountId', label: 'Sales revenue (Cr)', types: ['REVENUE'], required: true },
          { key: 'taxAccountId', label: 'Tax payable (Cr)', types: ['LIABILITY'] },
          { key: 'cogsAccountId', label: 'COGS (Dr)', types: ['EXPENSE'] },
          { key: 'inventoryAccountId', label: 'Inventory (Cr)', types: ['ASSET'] },
        ]}
      />
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function SalesPanel({
  title,
  empty,
  sales,
  currency,
  render,
}: {
  title: string;
  empty: string;
  sales: PosSale[];
  currency: string;
  render: (s: PosSale) => React.ReactNode;
}) {
  return (
    <div className="rounded-xl border">
      <div className="border-b px-4 py-2 text-sm font-medium">{title}</div>
      <div className="divide-y">
        {sales.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          sales.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{s.saleNo}</span>
                <Badge variant={s.type === 'RETURN' ? 'destructive' : s.status === 'PARKED' ? 'secondary' : 'outline'} className="text-[10px]">
                  {s.status}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium tabular-nums">{formatMoney(s.total.amountMinor, currency)}</span>
                {render(s)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
