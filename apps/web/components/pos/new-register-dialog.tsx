'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Branch, PosRegister } from '@/lib/types';
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

interface Warehouse {
  id: string;
  name: string;
}

const PROVIDER_HELP: Record<string, string> = {
  NONE: 'Cash / manual only — card references are keyed by hand.',
  SIMULATED: 'Built-in test terminal that always approves. Great for trying card flows.',
  BRIDGE: 'A local agent on the till that talks to a real card reader over HTTP.',
};

/** Create a POS register (till) and configure its card-payment terminal. */
export function NewRegisterDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const EMPTY = { name: '', code: '', warehouseId: '', branchId: '', currency: 'PKR', cardTerminalProvider: 'NONE', cardTerminalUrl: '' };
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => apiGet<Warehouse[]>('/inventory/warehouses') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => apiGet<Branch[]>('/branches') });

  const create = useMutation({
    mutationFn: () =>
      apiPost<PosRegister>('/pos/registers', {
        name: form.name,
        ...(form.code ? { code: form.code } : {}),
        ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
        ...(form.branchId ? { branchId: form.branchId } : {}),
        currency: form.currency || 'PKR',
        cardTerminalProvider: form.cardTerminalProvider,
        ...(form.cardTerminalProvider === 'BRIDGE' && form.cardTerminalUrl ? { cardTerminalUrl: form.cardTerminalUrl } : {}),
      }),
    onSuccess: () => {
      toast.success('Register created');
      qc.invalidateQueries({ queryKey: ['pos-registers'] });
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e) => toast.error('Could not create register', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-4 w-4" /> Register
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New register</DialogTitle>
          <DialogDescription>A till where cashiers open shifts and ring sales.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rn">Name</Label>
              <Input id="rn" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Counter 1" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc">Code</Label>
              <Input id="rc" value={form.code} onChange={(e) => set('code')(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Warehouse (stock source)</Label>
              <Select value={form.warehouseId} onValueChange={set('warehouseId')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cur">Currency</Label>
              <Input id="cur" value={form.currency} maxLength={3} onChange={(e) => set('currency')(e.target.value.toUpperCase())} />
            </div>
          </div>
          {(branches.data ?? []).length > 0 ? (
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={form.branchId} onValueChange={set('branchId')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(branches.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.city ? ` · ${b.city}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Card terminal</Label>
            <Select value={form.cardTerminalProvider} onValueChange={set('cardTerminalProvider')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None (manual)</SelectItem>
                <SelectItem value="SIMULATED">Simulated (test)</SelectItem>
                <SelectItem value="BRIDGE">Local bridge (real reader)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{PROVIDER_HELP[form.cardTerminalProvider]}</p>
          </div>
          {form.cardTerminalProvider === 'BRIDGE' ? (
            <div className="space-y-2">
              <Label htmlFor="turl">Terminal agent URL</Label>
              <Input id="turl" value={form.cardTerminalUrl} onChange={(e) => set('cardTerminalUrl')(e.target.value)} placeholder="http://localhost:9123/charge" />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create register'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
