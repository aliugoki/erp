'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageX, RotateCcw, Trash2, SlidersHorizontal } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { formatMoney } from '@/lib/utils';
import { type Lot, Hint, Spinner, fmtDate } from '@/components/pharmacy/pharm-ui';

interface AdjustmentRow {
  id: string;
  adj_no: string;
  type: string;
  reason: string | null;
  currency: string;
  total_minor: number;
  occurred_on: string | null;
  vendor: string | null;
  line_count: number;
}

const TYPE_TONE: Record<string, string> = {
  RTV: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  WRITEOFF: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
  ADJUST: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
};
const TYPE_LABEL: Record<string, string> = { RTV: 'Return to vendor', WRITEOFF: 'Write-off', ADJUST: 'Adjustment' };

/** The adjustments rail/list — history + a one-click expiry purge. */
export function AdjustmentsList() {
  const qc = useQueryClient();
  const adjustments = useQuery({ queryKey: ['pharm-adjustments'], queryFn: () => apiGet<AdjustmentRow[]>('/pharmacy/adjustments') });

  const purge = useMutation({
    mutationFn: () => apiPost<{ adjNo: string; lines: number }>('/pharmacy/write-off-expired', { reason: 'Expired purge' }),
    onSuccess: (d) => {
      toast.success('Expired stock written off', { description: `${d.adjNo} · ${d.lines} lot(s)` });
      for (const k of ['pharm-adjustments', 'pharm-lots', 'pharm-drugs', 'pharm-near-expiry']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error('Nothing to purge', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <>
      <PaneHeader>
        <span className="flex-1 text-sm font-medium">Stock adjustments</span>
        <Button size="sm" variant="outline" disabled={purge.isPending} onClick={() => purge.mutate()}>
          {purge.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageX className="mr-2 h-4 w-4" />} Write off expired
        </Button>
      </PaneHeader>
      <PaneBody>
        {adjustments.isLoading ? <Spinner /> : (adjustments.data ?? []).length === 0 ? <Hint>No adjustments yet. Use the lot actions on a batch, or purge expired stock.</Hint> : (
          <ul className="divide-y">{(adjustments.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.adj_no}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_TONE[a.type] ?? ''}`}>{TYPE_LABEL[a.type] ?? a.type}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{a.reason ?? a.vendor ?? '—'} · {a.line_count} line(s) · {fmtDate(a.occurred_on)}</div>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">{formatMoney(a.total_minor, a.currency)}</span>
            </li>
          ))}</ul>
        )}
      </PaneBody>
    </>
  );
}

/** Lot-level actions surfaced in the batch detail pane: write off, return to vendor, adjust out. */
export function LotActions({ lot }: { lot: Lot }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState('');
  const n = Number(qty);
  const valid = Number.isInteger(n) && n >= 1 && n <= lot.qtyOnHand;

  const invalidate = () => {
    for (const k of ['pharm-adjustments', 'pharm-lots', 'pharm-drugs', 'pharm-near-expiry']) qc.invalidateQueries({ queryKey: [k] });
    setQty('');
  };
  const run = (path: string, body: unknown, label: string) =>
    apiPost(path, body).then(() => { toast.success(`${label} posted`); invalidate(); }).catch((e) => toast.error(`${label} failed`, { description: e instanceof ApiError ? e.message : '' }));

  const writeOff = useMutation({ mutationFn: () => run('/pharmacy/write-off', { reason: 'Manual write-off', items: [{ lotId: lot.id, qty: n }] }, 'Write-off') });
  const rtv = useMutation({ mutationFn: () => run('/pharmacy/rtv', { reason: 'Return to vendor', items: [{ lotId: lot.id, qty: n }] }, 'Return') });
  const adjust = useMutation({ mutationFn: () => run('/pharmacy/adjust', { reason: 'Manual adjustment', items: [{ lotId: lot.id, qty: n, direction: 'OUT' }] }, 'Adjustment') });
  const busy = writeOff.isPending || rtv.isPending || adjust.isPending;

  return (
    <div className="mt-6 rounded-xl border p-4">
      <p className="mb-2 text-sm font-semibold">Lot actions</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min={1} max={lot.qtyOnHand} placeholder={`qty (≤ ${lot.qtyOnHand})`} className="h-9 w-36" />
        <Button size="sm" variant="outline" disabled={!valid || busy} onClick={() => writeOff.mutate()}><Trash2 className="mr-2 h-4 w-4 text-rose-600" /> Write off</Button>
        <Button size="sm" variant="outline" disabled={!valid || busy} onClick={() => rtv.mutate()}><RotateCcw className="mr-2 h-4 w-4 text-amber-600" /> Return to vendor</Button>
        <Button size="sm" variant="outline" disabled={!valid || busy} onClick={() => adjust.mutate()}><SlidersHorizontal className="mr-2 h-4 w-4 text-sky-600" /> Adjust out</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Removes stock from this lot (FEFO not used — this exact lot), valued through the ledger and posted to the GL.</p>
    </div>
  );
}
