'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiPost } from '@/lib/api';
import type { Lead } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** Convert a qualified lead into an account (+ primary contact) and, optionally, an opportunity. */
export function ConvertLeadDialog({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [createDeal, setCreateDeal] = useState(true);
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('');

  const convert = useMutation({
    mutationFn: () =>
      apiPost(`/crm/leads/${lead!.id}/convert`, {
        createDeal,
        dealTitle: dealTitle || undefined,
        dealValueMinor: dealValue ? Math.round(Number(dealValue) * 100) : undefined,
      }),
    onSuccess: () => {
      toast.success('Lead converted', { description: lead?.name });
      for (const k of ['leads', 'accounts', 'deals', 'pipeline', 'forecast']) qc.invalidateQueries({ queryKey: [k] });
      close();
    },
    onError: (e) => toast.error('Could not convert lead', { description: e instanceof ApiError ? e.message : '' }),
  });

  function close() {
    setCreateDeal(true);
    setDealTitle('');
    setDealValue('');
    onClose();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    convert.mutate();
  }

  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert {lead?.name}</DialogTitle>
          <DialogDescription>
            Creates an account ({lead?.company ?? lead?.name}) and a primary contact. Optionally open an opportunity.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Create an opportunity</p>
              <p className="text-xs text-muted-foreground">Seeded at the Qualified stage</p>
            </div>
            <Switch checked={createDeal} onCheckedChange={setCreateDeal} />
          </div>
          {createDeal ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="dt">Deal title</Label>
                <Input id="dt" value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} placeholder={`${lead?.company ?? lead?.name} opportunity`} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dv">Value</Label>
                <Input id="dv" type="number" min="0" step="0.01" value={dealValue} onChange={(e) => setDealValue(e.target.value)} placeholder={lead ? String(lead.estValue.amountMinor / 100) : ''} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={convert.isPending}>{convert.isPending ? 'Converting…' : 'Convert lead'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
