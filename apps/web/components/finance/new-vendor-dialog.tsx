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

export function NewVendorDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '' });

  const create = useMutation({
    mutationFn: () => apiPost('/finance/vendors', { name: f.name, email: f.email || undefined, phone: f.phone || undefined }),
    onSuccess: () => {
      toast.success('Vendor added', { description: f.name });
      qc.invalidateQueries({ queryKey: ['vendors'] });
      setOpen(false);
      setF({ name: '', email: '', phone: '' });
    },
    onError: (e) => toast.error('Could not add vendor', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="size-4" /> New vendor</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add vendor</DialogTitle>
          <DialogDescription>Suppliers you receive bills from.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vn">Name</Label>
            <Input id="vn" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Acme Supplies Ltd" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ve">Email</Label>
              <Input id="ve" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} placeholder="ar@acme.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vp">Phone</Label>
              <Input id="vp" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} placeholder="+92…" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Add vendor'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
