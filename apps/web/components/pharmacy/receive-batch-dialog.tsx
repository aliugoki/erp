'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { DrugListItem } from '@/components/pharmacy/pharm-ui';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

interface BatchRow {
  productId: string;
  lotNo: string;
  expiryDate: string;
  qty: string;
  unitCostMajor: string;
}

const EMPTY_ROW: BatchRow = { productId: '', lotNo: '', expiryDate: '', qty: '', unitCostMajor: '' };

export function ReceiveBatchDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [receivedOn, setReceivedOn] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<BatchRow[]>([{ ...EMPTY_ROW }]);

  const { data: drugs } = useQuery({
    queryKey: ['pharm-drugs'],
    queryFn: () => apiGet<DrugListItem[]>('/pharmacy/drugs'),
    enabled: open,
  });

  function reset() {
    setReceivedOn('');
    setNotes('');
    setRows([{ ...EMPTY_ROW }]);
  }

  const setRow = (i: number, k: keyof BatchRow) => (v: string) =>
    setRows((s) => s.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((s) => [...s, { ...EMPTY_ROW }]);
  const removeRow = (i: number) => setRows((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/pharmacy/stock/receive', {
        receivedOn: receivedOn.trim() ? receivedOn : undefined,
        notes: notes.trim() ? notes.trim() : undefined,
        items: rows.map((r) => ({
          productId: r.productId,
          lotNo: r.lotNo.trim(),
          expiryDate: r.expiryDate.trim() ? r.expiryDate : undefined,
          qty: Number(r.qty),
          unitCostMinor: r.unitCostMajor.trim() ? Math.round(Number(r.unitCostMajor) * 100) : undefined,
        })),
      }),
    onSuccess: (data) => {
      const { receiptNo } = data as { receiptNo: string };
      toast.success('Batch received', { description: receiptNo });
      qc.invalidateQueries({ queryKey: ['pharm-lots'] });
      qc.invalidateQueries({ queryKey: ['pharm-drugs'] });
      qc.invalidateQueries({ queryKey: ['pharm-near-expiry'] });
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error('Could not receive batch', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  const canSubmit = rows.every((r) => r.productId && r.lotNo.trim() && Number(r.qty) >= 1);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <PackagePlus className="size-4" /> Receive batch
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Receive batch</DialogTitle>
          <DialogDescription>Add one or more lots into stock.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ro">Received on</Label>
              <Input id="ro" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nt">Notes</Label>
              <Input id="nt" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-md border p-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Drug</Label>
                    <Select value={r.productId} onValueChange={setRow(i, 'productId')}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select drug" />
                      </SelectTrigger>
                      <SelectContent>
                        {(drugs ?? []).map((d) => (
                          <SelectItem key={d.productId} value={d.productId}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Lot no.</Label>
                    <Input value={r.lotNo} onChange={(e) => setRow(i, 'lotNo')(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expiry</Label>
                    <Input type="date" value={r.expiryDate} onChange={(e) => setRow(i, 'expiryDate')(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input type="number" min="1" value={r.qty} onChange={(e) => setRow(i, 'qty')(e.target.value)} required />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Unit cost</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.unitCostMajor}
                        onChange={(e) => setRow(i, 'unitCostMajor')(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(i)}
                  disabled={rows.length === 1}
                  aria-label="Remove row"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="size-4" /> Add line
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || create.isPending}>
              {create.isPending ? 'Receiving…' : 'Receive batch'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
