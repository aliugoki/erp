'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { DirectionBadge, DocStatusBadge, fmtDate } from './inv-ui';

interface GpItem { id: string; productId: string | null; description: string; qty: number }
interface GatePass { id: string; gpNo: string; direction: string; returnable: boolean; party: string | null; vehicleNo: string | null; status: string; issuedOn: string | null; remarks: string | null; items: GpItem[] }

/** Gate-pass detail + close action, sized to live inside the three-pane detail column. */
export function GatePassDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const gp = useQuery({ queryKey: ['gp', id], queryFn: () => apiGet<GatePass>(`/inventory/gate-passes/${id}`) });

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const close = useMutation({
    mutationFn: () => apiPost(`/inventory/gate-passes/${id}/close`, {}),
    onSuccess: () => {
      toast.success('Gate pass closed');
      void qc.invalidateQueries({ queryKey: ['gate-passes'] });
      void qc.invalidateQueries({ queryKey: ['gp', id] });
    },
    onError: onErr,
  });

  if (gp.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (gp.isError || !gp.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Gate pass not found.</div>;
  const g = gp.data;

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{g.gpNo}</span><DirectionBadge direction={g.direction} /><DocStatusBadge status={g.status} /></div>
        <div className="flex flex-wrap items-center gap-1.5">
          {g.status === 'OPEN' ? <Button variant="outline" size="sm" onClick={() => close.mutate()} disabled={close.isPending}><X className="mr-1.5 h-4 w-4" /> Close gate pass</Button> : null}
        </div>
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Party" value={g.party ?? '—'} />
          <Tile label="Vehicle" value={g.vehicleNo ?? '—'} />
          <Tile label="Issued" value={fmtDate(g.issuedOn)} />
          <Tile label="Returnable" value={g.returnable ? 'Yes' : 'No'} />
          <Tile label="Remarks" value={g.remarks ?? '—'} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Qty</th></tr>
              </thead>
              <tbody className="divide-y">
                {g.items.length === 0 ? (
                  <tr><td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">No items.</td></tr>
                ) : g.items.map((it) => (
                  <tr key={it.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-medium">{it.description}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{it.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PaneBody>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}
