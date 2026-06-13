'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
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

export function NewCostCenterDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', name: '' });

  const create = useMutation({
    mutationFn: () => apiPost('/finance/cost-centers', f),
    onSuccess: () => {
      toast.success('Cost center added', { description: `${f.code} · ${f.name}` });
      qc.invalidateQueries({ queryKey: ['cost-centers'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setOpen(false);
      setF({ code: '', name: '' });
    },
    onError: (e) => toast.error('Could not add cost center', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Plus className="size-4" /> New cost center</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add cost center</DialogTitle>
          <DialogDescription>Branch / department / project to slice income and expense by.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cc">Code</Label>
              <Input id="cc" value={f.code} onChange={(e) => setF((s) => ({ ...s, code: e.target.value }))} placeholder="HO" required />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="cn">Name</Label>
              <Input id="cn" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Head Office" required />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Add cost center'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
