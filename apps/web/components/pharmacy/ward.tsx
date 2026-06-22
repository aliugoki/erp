'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Building2, Loader2, Trash2, Check } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { type DrugListItem, Hint, Spinner, fmtDate } from '@/components/pharmacy/pharm-ui';

interface WardRow {
  id: string;
  req_no: string;
  ward: string;
  requested_by: string | null;
  priority: string;
  patient_ref: string | null;
  status: string;
  needed_by: string | null;
  item_count: number;
}

interface WardDetail {
  id: string;
  reqNo: string;
  ward: string;
  requestedBy: string | null;
  priority: string;
  patientRef: string | null;
  status: string;
  neededBy: string | null;
  notes: string | null;
  items: Array<{ id: string; productId: string; sku: string; name: string; qty: number; issuedQty: number }>;
}

const PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'] as const;

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  APPROVED: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  ISSUED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  CANCELLED: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
};

function WardStatus({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

interface ItemRow {
  productId: string;
  qty: string;
}

/** Hospital ward requisitions — request → submit → approve → issue (rings a HOSPITAL_ISSUE dispense). */
export function WardRequisitions() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const reqs = useQuery({ queryKey: ['pharm-ward'], queryFn: () => apiGet<WardRow[]>('/pharmacy/ward-requisitions') });

  return (
    <>
      <PaneHeader>
        <span className="flex-1 text-sm font-medium">Ward requisitions</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New requisition
        </Button>
      </PaneHeader>
      <PaneBody>
        {reqs.isLoading ? (
          <Spinner />
        ) : (reqs.data ?? []).length === 0 ? (
          <Hint>No ward requisitions yet. Create one to request stock for a ward.</Hint>
        ) : (
          <ul className="divide-y">
            {(reqs.data ?? []).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setDetailId(r.id)}
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.req_no}</span>
                      <WardStatus status={r.status} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.ward} · {r.priority}
                      {r.patient_ref ? ` · ${r.patient_ref}` : ''} · {r.item_count} item(s) · {fmtDate(r.needed_by)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PaneBody>

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} qc={qc} />
      <DetailDialog id={detailId} onClose={() => setDetailId(null)} qc={qc} />
    </>
  );
}

type Qc = ReturnType<typeof useQueryClient>;

function CreateDialog({ open, onOpenChange, qc }: { open: boolean; onOpenChange: (o: boolean) => void; qc: Qc }) {
  const [ward, setWard] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [priority, setPriority] = useState<string>('ROUTINE');
  const [patientRef, setPatientRef] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ productId: '', qty: '1' }]);

  const drugs = useQuery({ queryKey: ['pharm-drugs'], queryFn: () => apiGet<DrugListItem[]>('/pharmacy/drugs'), enabled: open });

  const reset = () => {
    setWard('');
    setRequestedBy('');
    setPriority('ROUTINE');
    setPatientRef('');
    setNeededBy('');
    setNotes('');
    setRows([{ productId: '', qty: '1' }]);
  };

  const setRow = (i: number, patch: Partial<ItemRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { productId: '', qty: '1' }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const rowsValid = rows.every((r) => r.productId !== '' && Number(r.qty) >= 1);
  const valid = ward.trim() !== '' && rowsValid;

  const create = useMutation({
    mutationFn: () =>
      apiPost('/pharmacy/ward-requisitions', {
        ward: ward.trim(),
        requestedBy: requestedBy.trim() || undefined,
        priority,
        patientRef: patientRef.trim() || undefined,
        neededBy: neededBy || undefined,
        notes: notes.trim() || undefined,
        items: rows.map((r) => ({ productId: r.productId, qty: Number(r.qty) })),
      }),
    onSuccess: () => {
      toast.success('Requisition created', { description: ward.trim() });
      qc.invalidateQueries({ queryKey: ['pharm-ward'] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error('Could not create requisition', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New ward requisition</DialogTitle>
          <DialogDescription>Request stock for a hospital ward. Issuing later rings a ward dispense.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ward">Ward</Label>
              <Input id="ward" value={ward} onChange={(e) => setWard(e.target.value)} placeholder="Ward 3B" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reqby">Requested by</Label>
              <Input id="reqby" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="Nurse / sister" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prio">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="prio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="needed">Needed by</Label>
              <Input id="needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pref">Patient ref</Label>
              <Input id="pref" value={patientRef} onChange={(e) => setPatientRef(e.target.value)} placeholder="MRN / bed" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <Button type="button" size="sm" variant="outline" onClick={addRow}>
                <Plus className="mr-2 h-4 w-4" /> Add item
              </Button>
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={r.productId} onValueChange={(v) => setRow(i, { productId: v })}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={drugs.isLoading ? 'Loading drugs…' : 'Select drug'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(drugs.data ?? []).map((d) => (
                        <SelectItem key={d.productId} value={d.productId}>
                          {d.name}
                          {d.strength ? ` ${d.strength}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={r.qty}
                    onChange={(e) => setRow(i, { qty: e.target.value })}
                    className="h-9 w-24"
                    placeholder="qty"
                  />
                  <Button type="button" size="icon" variant="ghost" disabled={rows.length === 1} onClick={() => removeRow(i)}>
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ id, onClose, qc }: { id: string | null; onClose: () => void; qc: Qc }) {
  const detail = useQuery({
    queryKey: ['pharm-ward', id],
    queryFn: () => apiGet<WardDetail>(`/pharmacy/ward-requisitions/${id}`),
    enabled: id !== null,
  });

  const act = useMutation({
    mutationFn: ({ action }: { action: 'submit' | 'approve' | 'issue' | 'cancel' }) =>
      apiPost(`/pharmacy/ward-requisitions/${id}/${action}`, {}),
    onSuccess: (_d, { action }) => {
      toast.success(
        action === 'submit'
          ? 'Requisition submitted'
          : action === 'approve'
            ? 'Requisition approved'
            : action === 'issue'
              ? 'Stock issued to ward'
              : 'Requisition cancelled',
      );
      qc.invalidateQueries({ queryKey: ['pharm-ward'] });
      if (action === 'issue') {
        for (const k of ['pharm-dispenses', 'pharm-lots', 'pharm-drugs']) qc.invalidateQueries({ queryKey: [k] });
      }
      onClose();
    },
    onError: (e) => toast.error('Action failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  const d = detail.data;
  const status = d?.status ?? '';
  const nonTerminal = status === 'DRAFT' || status === 'SUBMITTED' || status === 'APPROVED';

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {d ? d.reqNo : 'Requisition'}
            {d ? <WardStatus status={d.status} /> : null}
          </DialogTitle>
          <DialogDescription>Ward requisition details and workflow actions.</DialogDescription>
        </DialogHeader>

        {detail.isLoading || !d ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Ward</dt>
                <dd>{d.ward}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Priority</dt>
                <dd>{d.priority}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Requested by</dt>
                <dd>{d.requestedBy ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Needed by</dt>
                <dd>{fmtDate(d.neededBy)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Patient ref</dt>
                <dd>{d.patientRef ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd>{d.notes ?? '—'}</dd>
              </div>
            </dl>

            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Issued</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {d.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">{it.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.issuedQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter>
              {status === 'DRAFT' && (
                <Button disabled={act.isPending} onClick={() => act.mutate({ action: 'submit' })}>
                  {act.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} Submit
                </Button>
              )}
              {status === 'SUBMITTED' && (
                <Button disabled={act.isPending} onClick={() => act.mutate({ action: 'approve' })}>
                  {act.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} Approve
                </Button>
              )}
              {status === 'APPROVED' && (
                <Button disabled={act.isPending} onClick={() => act.mutate({ action: 'issue' })}>
                  {act.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />} Issue
                </Button>
              )}
              {nonTerminal && (
                <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: 'cancel' })}>
                  <Trash2 className="mr-2 h-4 w-4 text-rose-600" /> Cancel
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
