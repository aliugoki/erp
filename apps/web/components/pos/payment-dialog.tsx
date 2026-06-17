'use client';
import { useMemo, useState } from 'react';
import { Banknote, CreditCard, Delete, Loader2, Smartphone, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import { PAYMENT_METHODS, type Tender, toMinor } from '@/lib/pos';
import type { TerminalChargeResult } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const METHOD_ICON: Record<string, typeof Banknote> = {
  CASH: Banknote,
  CARD: CreditCard,
  MOBILE: Smartphone,
  WALLET: Wallet,
  BANK: Wallet,
  CREDIT: Wallet,
  VOUCHER: Wallet,
};

export function PaymentDialog({
  open,
  onOpenChange,
  registerId,
  currency,
  totalMinor,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  registerId: string;
  currency: string;
  totalMinor: number;
  busy?: boolean;
  onConfirm: (tenders: Tender[]) => void;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(''); // major units as typed
  const [charging, setCharging] = useState(false);

  const paid = useMemo(() => tenders.reduce((s, t) => s + t.amountMinor, 0), [tenders]);
  const remaining = Math.max(0, totalMinor - paid);
  const change = Math.max(0, paid - totalMinor);
  const settled = paid >= totalMinor;
  const entered = toMinor(amount);
  const amountForTender = entered > 0 ? entered : remaining;

  const reset = () => {
    setTenders([]);
    setAmount('');
    setMethod('CASH');
  };
  const close = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const press = (d: string) => setAmount((a) => (d === '⌫' ? a.slice(0, -1) : a === '0' ? d : a + d));
  const quickCash = (minor: number) => addTender({ method: 'CASH', amountMinor: minor });
  const addTender = (t: Tender) => {
    setTenders((ts) => [...ts, t]);
    setAmount('');
  };

  async function chargeCard() {
    setCharging(true);
    try {
      const res = await apiPost<TerminalChargeResult>(`/pos/registers/${registerId}/charge`, { amountMinor: amountForTender });
      if (res.status === 'APPROVED') {
        addTender({
          method: 'CARD',
          amountMinor: amountForTender,
          reference: res.reference,
          cardScheme: res.scheme,
          cardLast4: res.last4,
        });
        toast.success(`Card approved${res.scheme ? ` · ${res.scheme} ••${res.last4}` : ''}`);
      } else {
        toast.error(res.message ?? `Card ${res.status.toLowerCase()}`);
      }
    } catch (e) {
      // No terminal configured (422) etc. — fall back to recording a manual card tender.
      if (e instanceof ApiError && e.status === 422) {
        addTender({ method: 'CARD', amountMinor: amountForTender, reference: 'manual' });
        toast.message('No terminal configured — recorded a manual card tender');
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Card terminal error');
      }
    } finally {
      setCharging(false);
    }
  }

  // Suggested cash buttons: exact, and the next round notes above the remaining amount.
  const remMajor = remaining / 100;
  const rounds = [Math.ceil(remMajor), Math.ceil(remMajor / 5) * 5, Math.ceil(remMajor / 10) * 10, Math.ceil(remMajor / 50) * 50];
  const quickAmounts = Array.from(new Set(rounds.filter((n) => n > 0))).slice(0, 4);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Left: amounts + tenders */}
          <div className="space-y-3">
            <div className="rounded-xl border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total due</span>
                <span className="text-xl font-semibold">{formatMoney(totalMinor, currency)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-medium">{formatMoney(paid, currency)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{change > 0 ? 'Change' : 'Remaining'}</span>
                <span className={`font-semibold ${change > 0 ? 'text-success' : 'text-warning'}`}>
                  {formatMoney(change > 0 ? change : remaining, currency)}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              {tenders.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tenders yet — choose a method and amount.</p>
              ) : (
                tenders.map((t, i) => {
                  const Icon = METHOD_ICON[t.method] ?? Wallet;
                  return (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-sm">
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" /> {t.method}
                        {t.cardLast4 ? <Badge variant="outline">{t.cardScheme} ••{t.cardLast4}</Badge> : null}
                      </span>
                      <span className="flex items-center gap-2">
                        {formatMoney(t.amountMinor, currency)}
                        <button onClick={() => setTenders((ts) => ts.filter((_, j) => j !== i))} aria-label="Remove tender">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {quickAmounts.map((n) => (
                <Button key={n} variant="outline" size="sm" onClick={() => quickCash(n * 100)}>
                  {formatMoney(n * 100, currency)}
                </Button>
              ))}
              <Button variant="outline" size="sm" onClick={() => quickCash(remaining)} disabled={remaining === 0}>
                Exact
              </Button>
            </div>
          </div>

          {/* Right: method + keypad */}
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-1.5">
              {PAYMENT_METHODS.map((m) => (
                <Button
                  key={m}
                  variant={method === m ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs"
                  onClick={() => setMethod(m)}
                >
                  {m}
                </Button>
              ))}
            </div>

            <div className="rounded-lg border px-3 py-2 text-right text-2xl font-semibold tabular-nums">
              {amount || (amountForTender / 100).toFixed(2)}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
                <Button key={k} variant="outline" className="h-11 text-lg" onClick={() => press(k)}>
                  {k === '⌫' ? <Delete className="h-5 w-5" /> : k}
                </Button>
              ))}
            </div>

            {method === 'CARD' ? (
              <Button className="w-full" onClick={chargeCard} disabled={charging || amountForTender <= 0}>
                {charging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                Charge {formatMoney(amountForTender, currency)} on terminal
              </Button>
            ) : (
              <Button
                className="w-full"
                variant="secondary"
                onClick={() => addTender({ method, amountMinor: amountForTender })}
                disabled={amountForTender <= 0}
              >
                Add {method} {formatMoney(amountForTender, currency)}
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(tenders)} disabled={!settled || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Complete sale {change > 0 ? `· change ${formatMoney(change, currency)}` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
