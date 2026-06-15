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

/** Add a customer — gets its own RECEIVABLE sub-account in the chart of accounts automatically. */
export function NewCustomerDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '' });

  const create = useMutation({
    mutationFn: () => apiPost<{ accountCode: string | null }>('/finance/customers', { name: f.name, email: f.email || undefined, phone: f.phone || undefined }),
    onSuccess: (r) => {
      toast.success('Customer added', { description: r.accountCode ? `Ledger account ${r.accountCode} created` : f.name });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setOpen(false);
      setF({ name: '', email: '', phone: '' });
    },
    onError: (e) => toast.error('Could not add customer', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="size-4" /> New customer</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>Parties you bill. Each gets a receivable account in the chart of accounts.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cn">Name</Label>
            <Input id="cn" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Globex Corp" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ce">Email</Label>
              <Input id="ce" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} placeholder="ap@globex.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cp">Phone</Label>
              <Input id="cp" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} placeholder="+92…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Add customer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
