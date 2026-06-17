'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, Loader2, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Asset, AssetScheduleRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline', ACTIVE: 'default', DISPOSED: 'secondary', WRITTEN_OFF: 'destructive',
};

export function AssetDetailDialog({ assetId, open, onOpenChange }: { assetId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [showSchedule, setShowSchedule] = useState(false);
  const [proceeds, setProceeds] = useState('');

  const asset = useQuery({ queryKey: ['asset', assetId], queryFn: () => apiGet<Asset>(`/assets/${assetId}`), enabled: !!assetId && open });
  const schedule = useQuery({ queryKey: ['asset-schedule', assetId], queryFn: () => apiGet<AssetScheduleRow[]>(`/assets/${assetId}/schedule`), enabled: !!assetId && open && showSchedule });
  const a = asset.data;
  const currency = a?.acquisitionCost.currency ?? 'PKR';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['asset', assetId] });
    void qc.invalidateQueries({ queryKey: ['assets'] });
    void qc.invalidateQueries({ queryKey: ['asset-register'] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => apiPost(`/assets/${assetId}/${path}`, body ?? {}),
    onSuccess: () => { toast.success('Done'); setProceeds(''); refresh(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action failed'),
  });

  const status = a?.status ?? '';
  const open1 = status === 'DRAFT' || status === 'ACTIVE';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> {a?.assetNo ?? 'Asset'}
            {a ? <Badge variant={STATUS_VARIANT[a.status] ?? 'outline'}>{a.status}</Badge> : null}
          </DialogTitle>
        </DialogHeader>

        {!a ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-lg font-medium">{a.name}</p>
              <p className="text-sm text-muted-foreground">{[a.categoryName, a.location, a.custodianName].filter(Boolean).join(' · ') || '—'}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Cost" value={formatMoney(a.acquisitionCost.amountMinor, currency)} />
              <Stat label="Accumulated" value={formatMoney(a.accumulatedDepreciation.amountMinor, currency)} />
              <Stat label="Book value" value={formatMoney(a.bookValue.amountMinor, currency)} />
              <Stat label="Method" value={`${a.method.replace('_', ' ').toLowerCase()} · ${a.usefulLifeMonths}m`} />
            </div>

            {a.disposalGain != null ? (
              <div className="rounded-lg border px-3 py-2 text-sm">
                Disposed {a.disposalDate} — proceeds {formatMoney(a.disposalProceeds?.amountMinor ?? 0, currency)},{' '}
                <span className={a.disposalGain.amountMinor >= 0 ? 'text-success' : 'text-destructive'}>
                  {a.disposalGain.amountMinor >= 0 ? 'gain' : 'loss'} {formatMoney(Math.abs(a.disposalGain.amountMinor), currency)}
                </span>
              </div>
            ) : null}

            {/* Depreciation history */}
            <Section title={`Depreciation history (${a.depreciation?.length ?? 0})`} action={
              <button className="text-xs text-primary hover:underline" onClick={() => setShowSchedule((s) => !s)}>
                {showSchedule ? 'Hide schedule' : 'Preview schedule'}
              </button>
            }>
              {(a.depreciation ?? []).length === 0 ? <p className="py-1 text-xs text-muted-foreground">No depreciation posted yet.</p> : (
                (a.depreciation ?? []).slice(0, 8).map((d) => (
                  <div key={d.id} className="flex justify-between py-1 text-sm">
                    <span className="text-muted-foreground">{d.period}</span>
                    <span className="tabular-nums">−{formatMoney(d.amount.amountMinor, currency)} → {formatMoney(d.bookValueAfter.amountMinor, currency)}</span>
                  </div>
                ))
              )}
            </Section>

            {showSchedule ? (
              <Section title="Projected schedule">
                {schedule.isLoading ? <p className="py-1 text-xs text-muted-foreground">Loading…</p> :
                  (schedule.data ?? []).slice(0, 12).map((r) => (
                    <div key={r.period} className="flex justify-between py-0.5 text-xs">
                      <span className="text-muted-foreground"><TrendingDown className="mr-1 inline h-3 w-3" />Period {r.period}</span>
                      <span className="tabular-nums">−{formatMoney(r.amount.amountMinor, currency)} → {formatMoney(r.bookValue.amountMinor, currency)}</span>
                    </div>
                  ))}
              </Section>
            ) : null}

            {/* Maintenance */}
            {(a.maintenance ?? []).length > 0 ? (
              <Section title={`Maintenance (${a.maintenance?.length})`}>
                {(a.maintenance ?? []).slice(0, 6).map((mt) => (
                  <div key={mt.id} className="flex justify-between py-1 text-sm">
                    <span>{mt.maintDate} · {mt.type}{mt.description ? ` — ${mt.description}` : ''}</span>
                    <span className="tabular-nums text-muted-foreground">{formatMoney(mt.cost.amountMinor, currency)}</span>
                  </div>
                ))}
              </Section>
            ) : null}

            {/* Actions */}
            {open1 ? (
              <div className="space-y-2 border-t pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  {status === 'DRAFT' ? (
                    <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ path: 'activate' })}>
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Activate
                    </Button>
                  ) : null}
                  <Input className="h-8 w-32" type="number" min="0" step="0.01" placeholder="Proceeds" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
                  <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'dispose', body: { proceedsMinor: Math.round((Number(proceeds) || 0) * 100) } })}>
                    Dispose
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={act.isPending} onClick={() => act.mutate({ path: 'write-off' })}>
                    Write off
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium capitalize">{value}</p>
    </div>
  );
}
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        {action}
      </div>
      <div className="rounded-lg border px-3 py-1">{children}</div>
    </div>
  );
}
