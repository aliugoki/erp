'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { CrmAccount } from '@/lib/types';
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

const STAGES = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'];

export function NewDealDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stage, setStage] = useState('LEAD');

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<CrmAccount[]>('/crm/clients') });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/crm/deals', {
        clientId,
        title,
        stage,
        valueMinor: Math.round((Number(value) || 0) * 100),
      }),
    onSuccess: () => {
      toast.success('Opportunity created', { description: title });
      for (const k of ['deals', 'pipeline', 'forecast']) qc.invalidateQueries({ queryKey: [k] });
      setOpen(false);
      setClientId('');
      setTitle('');
      setValue('');
      setStage('LEAD');
    },
    onError: (e) => toast.error('Could not create opportunity', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New opportunity
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New opportunity</DialogTitle>
          <DialogDescription>A deal in the pipeline. Probability defaults from the stage.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="acc">Account</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="acc"><SelectValue placeholder="Select an account" /></SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.companyName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ti">Title</Label>
            <Input id="ti" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="va">Value</Label>
              <Input id="va" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg">Stage</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger id="sg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !clientId || !title.trim()}>
              {create.isPending ? 'Creating…' : 'Create opportunity'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
