'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Loader2, PackageMinus, Play, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { ProductionOrder } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline',
  PLANNED: 'secondary',
  RELEASED: 'secondary',
  IN_PROGRESS: 'default',
  COMPLETED: 'default',
  CANCELLED: 'destructive',
};

export function OrderDetailDialog({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const order = useQuery({
    queryKey: ['prod-order', orderId],
    queryFn: () => apiGet<ProductionOrder>(`/production/orders/${orderId}`),
    enabled: !!orderId && open,
  });
  const o = order.data;
  const currency = o?.totalCost.currency ?? 'PKR';

  const MSG: Record<string, string> = {
    plan: 'Order planned',
    release: 'Order released',
    issue: 'Materials issued',
    complete: 'Order completed — finished goods received',
    cancel: 'Order cancelled',
  };
  const act = useMutation({
    mutationFn: (path: string) => apiPost(`/production/orders/${orderId}/${path}`, {}),
    onSuccess: (_data, path) => {
      toast.success(MSG[path] ?? 'Done');
      void qc.invalidateQueries({ queryKey: ['prod-order', orderId] });
      void qc.invalidateQueries({ queryKey: ['prod-orders'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action failed'),
  });
  const busy = act.isPending;

  const status = o?.status ?? '';
  const canPlan = status === 'DRAFT';
  const canRelease = status === 'DRAFT' || status === 'PLANNED';
  const canRun = status === 'RELEASED' || status === 'IN_PROGRESS';
  const closed = status === 'COMPLETED' || status === 'CANCELLED';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> {o?.orderNo ?? 'Order'}
            {o ? <Badge variant={STATUS_VARIANT[o.status] ?? 'outline'}>{o.status}</Badge> : null}
          </DialogTitle>
        </DialogHeader>

        {!o ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Product" value={o.productName ?? '—'} />
              <Stat label="Planned" value={String(o.plannedQty)} />
              <Stat label="Produced" value={String(o.producedQty)} />
              <Stat label="Priority" value={o.priority} />
            </div>

            {/* Cost breakdown */}
            <div className="rounded-lg border p-3 text-sm">
              <CostRow label="Materials" v={o.materialCost.amountMinor} c={currency} />
              <CostRow label="Operations" v={o.operationCost.amountMinor} c={currency} />
              <CostRow label={`Overhead (${o.overheadPct}%)`} v={o.overhead.amountMinor} c={currency} />
              <div className="my-1 border-t" />
              <CostRow label="Total cost" v={o.totalCost.amountMinor} c={currency} bold />
              <CostRow label="Unit cost" v={o.unitCost.amountMinor} c={currency} />
            </div>

            {/* Materials */}
            <Section title="Materials">
              {(o.materials ?? []).map((m) => {
                const short = (m.onHand ?? 0) < m.requiredQty - m.issuedQty;
                return (
                  <div key={m.id} className="flex items-center justify-between py-1 text-sm">
                    <span className="truncate">{m.componentName}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{m.issuedQty}/{m.requiredQty} issued</span>
                      {short ? <Badge variant="destructive" className="text-[10px]">low stock</Badge> : null}
                      <span className="tabular-nums">{formatMoney(m.cost.amountMinor, currency)}</span>
                    </span>
                  </div>
                );
              })}
              {(o.materials ?? []).length === 0 ? <p className="py-1 text-xs text-muted-foreground">No materials.</p> : null}
            </Section>

            {/* Operations */}
            {(o.operations ?? []).length > 0 ? (
              <Section title="Operations">
                {(o.operations ?? []).map((op) => (
                  <div key={op.id} className="flex items-center justify-between py-1 text-sm">
                    <span className="truncate">{op.sequence}. {op.name} {op.workCenterName ? `· ${op.workCenterName}` : ''}</span>
                    <span className="text-xs text-muted-foreground">{op.actualMinutes || op.plannedMinutes} min · {formatMoney(op.cost.amountMinor, currency)}</span>
                  </div>
                ))}
              </Section>
            ) : null}

            {/* Attributes */}
            {(o.attributes ?? []).filter((a) => a.value).length > 0 ? (
              <Section title="Attributes">
                {(o.attributes ?? []).filter((a) => a.value).map((a) => (
                  <div key={a.attributeId} className="flex justify-between py-1 text-sm">
                    <span className="text-muted-foreground">{a.label}</span>
                    <span>{a.value}</span>
                  </div>
                ))}
              </Section>
            ) : null}

            {/* Lifecycle actions */}
            {!closed ? (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {canPlan ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate('plan')}><ClipboardList className="mr-1 h-4 w-4" /> Plan</Button> : null}
                {canRelease ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate('release')}><Send className="mr-1 h-4 w-4" /> Release</Button> : null}
                {canRun ? <Button size="sm" variant="outline" disabled={busy} onClick={() => act.mutate('issue')}><PackageMinus className="mr-1 h-4 w-4" /> Issue materials</Button> : null}
                {canRun ? <Button size="sm" disabled={busy} onClick={() => act.mutate('complete')}><CheckCircle2 className="mr-1 h-4 w-4" /> Complete</Button> : null}
                <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={busy} onClick={() => act.mutate('cancel')}><X className="mr-1 h-4 w-4" /> Cancel order</Button>
              </div>
            ) : (
              <p className="border-t pt-3 text-center text-sm text-muted-foreground">
                {status === 'COMPLETED' ? <><Play className="mr-1 inline h-4 w-4" />Completed — {o.producedQty} units received at {formatMoney(o.unitCost.amountMinor, currency)}/unit.</> : 'Order cancelled.'}
              </p>
            )}
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
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{title}</p>
      <div className="rounded-lg border px-3 py-1">{children}</div>
    </div>
  );
}
function CostRow({ label, v, c, bold }: { label: string; v: number; c: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{formatMoney(v, c)}</span>
    </div>
  );
}
