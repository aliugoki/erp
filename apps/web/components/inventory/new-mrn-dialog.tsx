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

interface IssueRow { id: string; issue_no: string }

export function NewMrnDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ issueId: '', returnedBy: '', returnedOn: '', notes: '' });
  const [lines, setLines] = useState<DocLine[]>([]);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products') });
  const { data: issues } = useQuery({ queryKey: ['issues'], queryFn: () => apiGet<IssueRow[]>('/inventory/issues') });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/inventory/mrns', {
        issueId: f.issueId || undefined,
        returnedBy: f.returnedBy || undefined,
        returnedOn: f.returnedOn ? new Date(f.returnedOn).toISOString() : undefined,
        notes: f.notes || undefined,
        items: toItems(lines),
      }),
    onSuccess: () => {
      toast.success('Material return created');
      qc.invalidateQueries({ queryKey: ['mrns'] });
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      setOpen(false);
      setF({ issueId: '', returnedBy: '', returnedOn: '', notes: '' });
      setLines([]);
    },
    onError: (e) => toast.error('Could not create material return', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!f.issueId && toItems(lines).length < 1) { toast.error('Select an issue or add at least one item'); return; }
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> New MRN
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New material return</DialogTitle>
          <DialogDescription>Return previously issued stock back into inventory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="issue">Issue</Label>
            <select id="issue" value={f.issueId} onChange={(e) => set('issueId')(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">No issue</option>
              {(issues ?? []).map((i) => <option key={i.id} value={i.id}>{i.issue_no}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rb">Returned by</Label>
            <Input id="rb" value={f.returnedBy} onChange={(e) => set('returnedBy')(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ro">Returned on</Label>
            <Input id="ro" type="date" value={f.returnedOn} onChange={(e) => set('returnedOn')(e.target.value)} />
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
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create MRN'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
