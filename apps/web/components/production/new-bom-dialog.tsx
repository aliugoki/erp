'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Product, WorkCenter } from '@/lib/types';
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

interface LineRow { componentProductId: string; quantity: number; scrapPct: number }
interface OpRow { name: string; workCenterId: string; runMinutes: number }

export function NewBomDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [name, setName] = useState('');
  const [outputQty, setOutputQty] = useState('1');
  const [overheadPct, setOverheadPct] = useState('0');
  const [lines, setLines] = useState<LineRow[]>([{ componentProductId: '', quantity: 1, scrapPct: 0 }]);
  const [ops, setOps] = useState<OpRow[]>([]);

  const products = useQuery({ queryKey: ['pos-products'], queryFn: () => apiGet<Product[]>('/inventory/products'), enabled: open });
  const workCenters = useQuery({ queryKey: ['prod-work-centers'], queryFn: () => apiGet<WorkCenter[]>('/production/work-centers'), enabled: open });

  const reset = () => {
    setProductId(''); setName(''); setOutputQty('1'); setOverheadPct('0');
    setLines([{ componentProductId: '', quantity: 1, scrapPct: 0 }]); setOps([]);
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost('/production/boms', {
        productId,
        name,
        outputQty: Number(outputQty) || 1,
        overheadPct: Number(overheadPct) || 0,
        lines: lines.filter((l) => l.componentProductId).map((l) => ({ componentProductId: l.componentProductId, quantity: l.quantity, scrapPct: l.scrapPct })),
        operations: ops.filter((o) => o.name).map((o, i) => ({ name: o.name, sequence: i + 1, runMinutes: o.runMinutes, ...(o.workCenterId ? { workCenterId: o.workCenterId } : {}) })),
      }),
    onSuccess: () => {
      toast.success('BOM created');
      qc.invalidateQueries({ queryKey: ['prod-boms'] });
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error('Could not create BOM', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!productId || lines.every((l) => !l.componentProductId)) {
      toast.error('Pick a product and at least one component');
      return;
    }
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New BOM</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New bill of materials</DialogTitle>
          <DialogDescription>Components + routing to build a finished good.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Finished product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {(products.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bn">BOM name</Label>
              <Input id="bn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard recipe" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="oq">Output qty / batch</Label>
              <Input id="oq" type="number" min="1" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oh">Overhead %</Label>
              <Input id="oh" type="number" min="0" max="100" value={overheadPct} onChange={(e) => setOverheadPct(e.target.value)} />
            </div>
          </div>

          {/* Components */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Components</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setLines((l) => [...l, { componentProductId: '', quantity: 1, scrapPct: 0 }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Select value={l.componentProductId} onValueChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, componentProductId: v } : x)))}>
                    <SelectTrigger><SelectValue placeholder="Component" /></SelectTrigger>
                    <SelectContent>
                      {(products.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Input className="w-20" type="number" min="1" value={l.quantity} title="Qty" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))} />
                <Input className="w-20" type="number" min="0" max="100" value={l.scrapPct} title="Scrap %" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, scrapPct: Number(e.target.value) } : x)))} />
                <Button type="button" variant="ghost" size="icon" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Routing */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Operations (routing)</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOps((o) => [...o, { name: '', workCenterId: '', runMinutes: 0 }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {ops.map((o, i) => (
              <div key={i} className="flex items-end gap-2">
                <Input className="flex-1" placeholder="Operation name" value={o.name} onChange={(e) => setOps((os) => os.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <div className="w-40">
                  <Select value={o.workCenterId} onValueChange={(v) => setOps((os) => os.map((x, j) => (j === i ? { ...x, workCenterId: v } : x)))}>
                    <SelectTrigger><SelectValue placeholder="Work center" /></SelectTrigger>
                    <SelectContent>
                      {(workCenters.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Input className="w-20" type="number" min="0" value={o.runMinutes} title="Minutes" onChange={(e) => setOps((os) => os.map((x, j) => (j === i ? { ...x, runMinutes: Number(e.target.value) } : x)))} />
                <Button type="button" variant="ghost" size="icon" onClick={() => setOps((os) => os.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create BOM'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
