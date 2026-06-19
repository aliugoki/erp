'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface GpRow { description: string; qty: string }

export function NewGatePassDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ direction: 'OUTWARD', returnable: false, party: '', vehicleNo: '', issuedOn: '', remarks: '' });
  const [rows, setRows] = useState<GpRow[]>([]);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const setRow = (i: number, patch: Partial<GpRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { description: '', qty: '1' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/inventory/gate-passes', {
        direction: f.direction,
        returnable: f.returnable,
        party: f.party || undefined,
        vehicleNo: f.vehicleNo || undefined,
        issuedOn: f.issuedOn ? new Date(f.issuedOn).toISOString() : undefined,
        remarks: f.remarks || undefined,
        items: rows.filter((r) => r.description.trim() && Number(r.qty) > 0).map((r) => ({ description: r.description, qty: Number(r.qty) })),
      }),
    onSuccess: () => {
      toast.success('Gate pass created');
      qc.invalidateQueries({ queryKey: ['gate-passes'] });
      setOpen(false);
      setF({ direction: 'OUTWARD', returnable: false, party: '', vehicleNo: '', issuedOn: '', remarks: '' });
      setRows([]);
    },
    onError: (e) => toast.error('Could not create gate pass', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (rows.filter((r) => r.description.trim() && Number(r.qty) > 0).length < 1) { toast.error('Add at least one item'); return; }
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> New gate pass
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New gate pass</DialogTitle>
          <DialogDescription>Record goods moving in or out of the premises.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dir">Direction</Label>
              <select id="dir" value={f.direction} onChange={(e) => set('direction')(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="OUTWARD">OUTWARD</option>
                <option value="INWARD">INWARD</option>
              </select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <input id="ret" type="checkbox" checked={f.returnable} onChange={(e) => set('returnable')(e.target.checked)} className="h-4 w-4 rounded border" />
              <Label htmlFor="ret">Returnable</Label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="party">Party</Label>
              <Input id="party" value={f.party} onChange={(e) => set('party')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="veh">Vehicle no.</Label>
              <Input id="veh" value={f.vehicleNo} onChange={(e) => set('vehicleNo')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="io">Issued on</Label>
            <Input id="io" type="date" value={f.issuedOn} onChange={(e) => set('issuedOn')(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rem">Remarks</Label>
            <textarea id="rem" value={f.remarks} onChange={(e) => set('remarks')(e.target.value)} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-2">
            <Label>Items</Label>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} className="h-9 min-w-0 flex-1" placeholder="Description" />
                  <Input value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} type="number" min={1} className="h-9 w-20" placeholder="Qty" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} title="Remove"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addRow}><Plus className="mr-1.5 h-4 w-4" /> Add line</Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create gate pass'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
