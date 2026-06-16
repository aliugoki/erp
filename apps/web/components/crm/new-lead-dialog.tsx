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

const EMPTY = { name: '', company: '', email: '', phone: '', source: '', rating: 'WARM', estValue: '' };

export function NewLeadDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/crm/leads', {
        name: f.name,
        company: f.company || undefined,
        email: f.email || undefined,
        phone: f.phone || undefined,
        source: f.source || undefined,
        rating: f.rating,
        estValueMinor: Math.round((Number(f.estValue) || 0) * 100),
      }),
    onSuccess: () => {
      toast.success('Lead captured', { description: f.name });
      qc.invalidateQueries({ queryKey: ['leads'] });
      setOpen(false);
      setF(EMPTY);
    },
    onError: (e) => toast.error('Could not create lead', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New lead
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Capture lead</DialogTitle>
          <DialogDescription>A prospective buyer. Qualify it, then convert to an account + opportunity.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="nm">Name</Label>
              <Input id="nm" value={f.name} onChange={(e) => set('name')(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cm">Company</Label>
              <Input id="cm" value={f.company} onChange={(e) => set('company')(e.target.value)} />
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
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sr">Source</Label>
              <Input id="sr" value={f.source} onChange={(e) => set('source')(e.target.value)} placeholder="Web" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ra">Rating</Label>
              <Select value={f.rating} onValueChange={set('rating')}>
                <SelectTrigger id="ra"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOT">Hot</SelectItem>
                  <SelectItem value="WARM">Warm</SelectItem>
                  <SelectItem value="COLD">Cold</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev">Est. value</Label>
              <Input id="ev" type="number" min="0" step="0.01" value={f.estValue} onChange={(e) => set('estValue')(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !f.name.trim()}>
              {create.isPending ? 'Saving…' : 'Capture lead'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
