'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import { DRUG_FORMS, DRUG_SCHEDULES } from '@/components/pharmacy/pharm-ui';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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

const EMPTY = {
  sku: '',
  name: '',
  genericName: '',
  brand: '',
  manufacturer: '',
  strength: '',
  packSize: '',
  therapeuticCategory: '',
  barcode: '',
  reorderLevel: '',
};

export function NewDrugDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [form, setForm] = useState<string>('TABLET');
  const [schedule, setSchedule] = useState<string>('OTC');
  const [rxRequired, setRxRequired] = useState(false);
  const [controlled, setControlled] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  function reset() {
    setF(EMPTY);
    setForm('TABLET');
    setSchedule('OTC');
    setRxRequired(false);
    setControlled(false);
  }

  const create = useMutation({
    mutationFn: () => {
      const trim = (v: string) => (v.trim() ? v.trim() : undefined);
      const int = (v: string) => (v.trim() ? Number(v) : undefined);
      return apiPost('/pharmacy/drugs', {
        sku: f.sku.trim(),
        name: f.name.trim(),
        genericName: trim(f.genericName),
        brand: trim(f.brand),
        manufacturer: trim(f.manufacturer),
        strength: trim(f.strength),
        form,
        packSize: int(f.packSize),
        schedule,
        rxRequired,
        controlled,
        therapeuticCategory: trim(f.therapeuticCategory),
        barcode: trim(f.barcode),
        reorderLevel: int(f.reorderLevel),
      });
    },
    onSuccess: () => {
      toast.success('Drug added', { description: f.name });
      qc.invalidateQueries({ queryKey: ['pharm-drugs'] });
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error('Could not add drug', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  const canSubmit = f.sku.trim().length > 0 && f.name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New drug
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add drug</DialogTitle>
          <DialogDescription>Register a drug. Price is set later in the drug detail.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" value={f.sku} onChange={(e) => set('sku')(e.target.value)} placeholder="PARA-500" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bc">Barcode</Label>
              <Input id="bc" value={f.barcode} onChange={(e) => set('barcode')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm">Name</Label>
            <Input id="nm" value={f.name} onChange={(e) => set('name')(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="gn">Generic name</Label>
              <Input id="gn" value={f.genericName} onChange={(e) => set('genericName')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="br">Brand</Label>
              <Input id="br" value={f.brand} onChange={(e) => set('brand')(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mf">Manufacturer</Label>
              <Input id="mf" value={f.manufacturer} onChange={(e) => set('manufacturer')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st">Strength</Label>
              <Input id="st" value={f.strength} onChange={(e) => set('strength')(e.target.value)} placeholder="500mg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fm">Form</Label>
              <Select value={form} onValueChange={setForm}>
                <SelectTrigger id="fm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DRUG_FORMS.map((x) => (
                    <SelectItem key={x} value={x}>
                      {x}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sc">Schedule</Label>
              <Select value={schedule} onValueChange={setSchedule}>
                <SelectTrigger id="sc">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DRUG_SCHEDULES.map((x) => (
                    <SelectItem key={x} value={x}>
                      {x}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ps">Pack size</Label>
              <Input id="ps" type="number" min="0" value={f.packSize} onChange={(e) => set('packSize')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rl">Reorder level</Label>
              <Input id="rl" type="number" min="0" value={f.reorderLevel} onChange={(e) => set('reorderLevel')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tc">Therapeutic category</Label>
            <Input id="tc" value={f.therapeuticCategory} onChange={(e) => set('therapeuticCategory')(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="rx">Rx required</Label>
              <Switch id="rx" checked={rxRequired} onCheckedChange={setRxRequired} />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="ct">Controlled</Label>
              <Switch id="ct" checked={controlled} onCheckedChange={setControlled} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || create.isPending}>
              {create.isPending ? 'Adding…' : 'Add drug'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
