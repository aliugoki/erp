'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { AssetCategory, Employee } from '@/lib/types';
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

export function NewAssetDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const EMPTY = { name: '', categoryId: '', acquisitionDate: '', cost: '', salvage: '', custodianEmployeeId: '', location: '', serialNo: '', supplier: '' };
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const categories = useQuery({ queryKey: ['asset-categories'], queryFn: () => apiGet<AssetCategory[]>('/assets/categories'), enabled: open });
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => apiGet<Employee[]>('/hr/employees'), enabled: open, retry: false });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/assets', {
        name: form.name,
        ...(form.categoryId ? { categoryId: form.categoryId } : {}),
        ...(form.acquisitionDate ? { acquisitionDate: form.acquisitionDate } : {}),
        acquisitionCostMinor: Math.round((Number(form.cost) || 0) * 100),
        ...(form.salvage ? { salvageValueMinor: Math.round(Number(form.salvage) * 100) } : {}),
        ...(form.custodianEmployeeId ? { custodianEmployeeId: form.custodianEmployeeId } : {}),
        ...(form.location ? { location: form.location } : {}),
        ...(form.serialNo ? { serialNo: form.serialNo } : {}),
        ...(form.supplier ? { supplier: form.supplier } : {}),
      }),
    onSuccess: () => {
      toast.success('Asset created (draft)');
      qc.invalidateQueries({ queryKey: ['assets'] });
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e) => toast.error('Could not create asset', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.cost) return toast.error('Name and acquisition cost are required');
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(EMPTY); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New asset</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New asset</DialogTitle>
          <DialogDescription>Created as a draft; activate it to start depreciation. Policy defaults from the category.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="an">Name</Label>
            <Input id="an" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Forklift #2" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.categoryId} onValueChange={set('categoryId')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(categories.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ad">Acquisition date</Label>
              <Input id="ad" type="date" value={form.acquisitionDate} onChange={(e) => set('acquisitionDate')(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cost">Cost (PKR)</Label>
              <Input id="cost" type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set('cost')(e.target.value)} placeholder="0.00" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salv">Salvage value (PKR)</Label>
              <Input id="salv" type="number" min="0" step="0.01" value={form.salvage} onChange={(e) => set('salvage')(e.target.value)} placeholder="from category" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Custodian</Label>
              <Select value={form.custodianEmployeeId} onValueChange={set('custodianEmployeeId')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(employees.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc">Location</Label>
              <Input id="loc" value={form.location} onChange={(e) => set('location')(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sn">Serial no.</Label>
              <Input id="sn" value={form.serialNo} onChange={(e) => set('serialNo')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup">Supplier</Label>
              <Input id="sup" value={form.supplier} onChange={(e) => set('supplier')(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create asset'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
