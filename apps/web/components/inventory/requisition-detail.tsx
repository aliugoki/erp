'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, PackageCheck, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { DocStatusBadge, fmtDate } from './inv-ui';

interface ReqItem { id: string; productId: string; sku: string; name: string; qty: number; issuedQty: number }
interface Requisition { id: string; reqNo: string; status: string; requestedBy: string | null; department: string | null; neededBy: string | null; notes: string | null; items: ReqItem[] }

/** Requisition detail + lifecycle actions, sized to live inside the three-pane detail column. */
export function RequisitionDetail({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const req = useQuery({ queryKey: ['req', id], queryFn: () => apiGet<Requisition>(`/inventory/requisitions/${id}`) });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['requisitions'] });
    void qc.invalidateQueries({ queryKey: ['req', id] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const submit = useMutation({ mutationFn: () => apiPost(`/inventory/requisitions/${id}/submit`, {}), onSuccess: () => { toast.success('Submitted'); invalidate(); }, onError: onErr });
  const approve = useMutation({ mutationFn: () => apiPost(`/inventory/requisitions/${id}/approve`, {}), onSuccess: () => { toast.success('Approved'); invalidate(); }, onError: onErr });
  const cancel = useMutation({ mutationFn: () => apiPost(`/inventory/requisitions/${id}/cancel`, {}), onSuccess: () => { toast.success('Cancelled'); invalidate(); onDeleted?.(); }, onError: onErr });
  const issue = useMutation({
    mutationFn: () => apiPost('/inventory/issues', { requisitionId: id }),
    onSuccess: () => {
      toast.success('Stock issued');
      invalidate();
      void qc.invalidateQueries({ queryKey: ['issues'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: onErr,
  });

  if (req.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (req.isError || !req.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Requisition not found.</div>;
  const r = req.data;
  const canCancel = r.status === 'DRAFT' || r.status === 'SUBMITTED' || r.status === 'APPROVED';

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{r.reqNo}</span><DocStatusBadge status={r.status} /></div>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.status === 'DRAFT' ? <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}><Send className="mr-1.5 h-4 w-4" /> Submit</Button> : null}
          {r.status === 'SUBMITTED' ? <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending}><Check className="mr-1.5 h-4 w-4" /> Approve</Button> : null}
          {r.status === 'APPROVED' ? <Button size="sm" onClick={() => issue.mutate()} disabled={issue.isPending}><PackageCheck className="mr-1.5 h-4 w-4" /> Issue stock</Button> : null}
          {canCancel ? <Button variant="outline" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}><X className="mr-1.5 h-4 w-4" /> Cancel</Button> : null}
        </div>
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Requested by" value={r.requestedBy ?? '—'} />
          <Tile label="Department" value={r.department ?? '—'} />
          <Tile label="Needed by" value={fmtDate(r.neededBy)} />
          <Tile label="Notes" value={r.notes ?? '—'} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Issued</th></tr>
              </thead>
              <tbody className="divide-y">
                {r.items.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No items.</td></tr>
                ) : r.items.map((it) => (
                  <tr key={it.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5"><div className="font-medium">{it.name}</div><div className="text-xs text-muted-foreground">{it.sku}</div></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{it.qty}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{it.issuedQty}</td>
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
