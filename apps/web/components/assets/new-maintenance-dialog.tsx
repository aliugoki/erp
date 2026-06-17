'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Asset } from '@/lib/types';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TYPES = ['SERVICE', 'REPAIR', 'INSPECTION', 'UPGRADE', 'OTHER'];

export function NewMaintenanceDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const EMPTY = { assetId: '', maintDate: '', type: 'SERVICE', description: '', cost: '', vendor: '', nextDueDate: '' };
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const assets = useQuery({ queryKey: ['assets'], queryFn: () => apiGet<Asset[]>('/assets'), enabled: open });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/assets/maintenance', {
        assetId: form.assetId,
        ...(form.maintDate ? { maintDate: form.maintDate } : {}),
        type: form.type,
        ...(form.description ? { description: form.description } : {}),
        costMinor: Math.round((Number(form.cost) || 0) * 100),
        ...(form.vendor ? { vendor: form.vendor } : {}),
        ...(form.nextDueDate ? { nextDueDate: form.nextDueDate } : {}),
      }),
    onSuccess: () => {
      toast.success('Maintenance logged');
      qc.invalidateQueries({ queryKey: ['asset-maintenance'] });
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e) => toast.error('Could not log maintenance', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.assetId) return toast.error('Pick an asset');
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(EMPTY); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Log maintenance</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log maintenance</DialogTitle>
          <DialogDescription>Record upkeep and an optional next-due date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Asset</Label>
            <Select value={form.assetId} onValueChange={set('assetId')}>
              <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
              <SelectContent>
                {(assets.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.assetNo} · {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="md">Date</Label>
              <Input id="md" type="date" value={form.maintDate} onChange={(e) => set('maintDate')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={set('type')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Input id="desc" value={form.description} onChange={(e) => set('description')(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mc">Cost (PKR)</Label>
              <Input id="mc" type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set('cost')(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vn">Vendor</Label>
              <Input id="vn" value={form.vendor} onChange={(e) => set('vendor')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nd">Next due</Label>
              <Input id="nd" type="date" value={form.nextDueDate} onChange={(e) => set('nextDueDate')(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Log maintenance'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
