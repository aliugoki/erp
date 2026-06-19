'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Product } from '@/lib/types';
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
import { LineItemsEditor, toItems, type DocLine } from './line-items-editor';

interface RequisitionRow { id: string; req_no: string; status: string }

export function NewIssueDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ requisitionId: '', issuedTo: '', department: '', issuedOn: '', notes: '' });
  const [lines, setLines] = useState<DocLine[]>([]);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products') });
  const { data: requisitions } = useQuery({ queryKey: ['requisitions'], queryFn: () => apiGet<RequisitionRow[]>('/inventory/requisitions') });
  const approved = (requisitions ?? []).filter((r) => r.status === 'APPROVED');

  const create = useMutation({
    mutationFn: () =>
      apiPost('/inventory/issues', {
        requisitionId: f.requisitionId || undefined,
        issuedTo: f.issuedTo || undefined,
        department: f.department || undefined,
        issuedOn: f.issuedOn ? new Date(f.issuedOn).toISOString() : undefined,
        notes: f.notes || undefined,
        items: toItems(lines),
      }),
    onSuccess: () => {
      toast.success('Stock issued');
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['requisitions'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      setOpen(false);
      setF({ requisitionId: '', issuedTo: '', department: '', issuedOn: '', notes: '' });
      setLines([]);
    },
    onError: (e) => toast.error('Could not issue stock', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!f.requisitionId && toItems(lines).length < 1) { toast.error('Select a requisition or add at least one item'); return; }
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> New issue
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New issue</DialogTitle>
          <DialogDescription>Issue stock against an approved requisition or directly.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="req">Requisition</Label>
            <select id="req" value={f.requisitionId} onChange={(e) => set('requisitionId')(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">No requisition</option>
              {approved.map((r) => <option key={r.id} value={r.id}>{r.req_no}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="it">Issued to</Label>
              <Input id="it" value={f.issuedTo} onChange={(e) => set('issuedTo')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dep">Department</Label>
              <Input id="dep" value={f.department} onChange={(e) => set('department')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="io">Issued on</Label>
            <Input id="io" type="date" value={f.issuedOn} onChange={(e) => set('issuedOn')(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea id="notes" value={f.notes} onChange={(e) => set('notes')(e.target.value)} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-2">
            <Label>Items</Label>
            <LineItemsEditor products={products ?? []} lines={lines} onChange={setLines} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Issuing…' : 'Issue stock'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
