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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EMPTY = { companyName: '', industry: '', email: '', phone: '', city: '', country: '', status: 'PROSPECT' };

export function NewAccountDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/crm/clients', {
        companyName: f.companyName,
        industry: f.industry || undefined,
        email: f.email || undefined,
        phone: f.phone || undefined,
        city: f.city || undefined,
        country: f.country || undefined,
        status: f.status,
      }),
    onSuccess: () => {
      toast.success('Account created', { description: f.companyName });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setOpen(false);
      setF(EMPTY);
    },
    onError: (e) => toast.error('Could not create account', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>A company you sell to. An account number is assigned automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cn">Company name</Label>
            <Input id="cn" value={f.companyName} onChange={(e) => set('companyName')(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ind">Industry</Label>
              <Input id="ind" value={f.industry} onChange={(e) => set('industry')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st">Status</Label>
              <Select value={f.status} onValueChange={set('status')}>
                <SelectTrigger id="st"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROSPECT">Prospect</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="em">Email</Label>
              <Input id="em" type="email" value={f.email} onChange={(e) => set('email')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ph">Phone</Label>
              <Input id="ph" value={f.phone} onChange={(e) => set('phone')(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ci">City</Label>
              <Input id="ci" value={f.city} onChange={(e) => set('city')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="co">Country</Label>
              <Input id="co" value={f.country} onChange={(e) => set('country')(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !f.companyName.trim()}>
              {create.isPending ? 'Creating…' : 'Create account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
