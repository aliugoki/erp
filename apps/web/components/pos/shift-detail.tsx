'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { PosShift } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { PosBadge, fmtDateTime } from './pos-ui';

/** A single cashier shift: float / cash reconciliation, its X/Z report, and an inline close form. */
export function ShiftDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const shift = useQuery({ queryKey: ['pos-shift-detail', id], queryFn: () => apiGet<PosShift>(`/pos/shifts/${id}`) });
  const [countedCash, setCountedCash] = useState('');

  const close = useMutation({
    mutationFn: () => apiPatch(`/pos/shifts/${id}/close`, { countedCashMinor: Math.round(Number(countedCash) * 100) }),
    onSuccess: () => {
      toast.success('Shift closed');
      void qc.invalidateQueries({ queryKey: ['pos-shifts'] });
      void qc.invalidateQueries({ queryKey: ['pos-shift-detail', id] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  if (shift.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (shift.isError || !shift.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Shift not found.</div>;
  const s = shift.data;
  const r = s.report;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{s.shiftNo}</span>
          <PosBadge status={s.status} />
        </div>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Opened" value={fmtDateTime(s.openedAt)} />
          <Tile label="Closed" value={fmtDateTime(s.closedAt)} />
          <Tile label="Opening float" value={formatMoney(s.openingFloat.amountMinor, s.openingFloat.currency)} />
          <Tile label="Counted" value={s.countedCash ? formatMoney(s.countedCash.amountMinor, s.countedCash.currency) : '—'} />
          <Tile label="Expected" value={s.expectedCash ? formatMoney(s.expectedCash.amountMinor, s.expectedCash.currency) : '—'} />
          <Tile label="Variance" value={s.variance ? formatMoney(s.variance.amountMinor, s.variance.currency) : '—'} tone={s.variance && s.variance.amountMinor < 0 ? 'rose' : 'default'} />
        </div>

        {r ? (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shift report</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Sales" value={String(r.saleCount)} />
              <Tile label="Returns" value={String(r.returnCount)} />
              <Tile label="Gross" value={formatMoney(r.grossSalesMinor, 'PKR')} />
              <Tile label="Refunds" value={formatMoney(r.refundsMinor, 'PKR')} />
              <Tile label="Net" value={formatMoney(r.netSalesMinor, 'PKR')} />
              <Tile label="Cash sales" value={formatMoney(r.cashSalesMinor, 'PKR')} />
              <Tile label="Change given" value={formatMoney(r.changeGivenMinor, 'PKR')} />
            </div>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Tender</th><th className="px-4 py-2 text-right">In</th><th className="px-4 py-2 text-right">Out</th></tr></thead>
                <tbody className="divide-y">
                  {r.tenders.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No tenders.</td></tr>
                  ) : (
                    r.tenders.map((t) => (
                      <tr key={t.method}>
                        <td className="px-4 py-2">{t.method}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.inMinor, 'PKR')}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(t.outMinor, 'PKR')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {s.status === 'OPEN' ? (
          <section className="max-w-sm space-y-3 rounded-xl border p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Close shift</h3>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Counted cash</span>
              <Input value={countedCash} onChange={(e) => setCountedCash(e.target.value)} type="number" min={0} step="0.01" placeholder="0.00" />
            </label>
            <Button variant="destructive" disabled={!countedCash.trim() || close.isPending} onClick={() => close.mutate()}>
              {close.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />} Close shift
            </Button>
          </section>
        ) : null}
      </PaneBody>
    </>
  );
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'rose' }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${tone === 'rose' ? 'text-rose-600' : ''}`}>{value}</p></div>;
}
