'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import type { Bill } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
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

export function PayBillDialog({ bill }: { bill: Bill }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');

  const pay = useMutation({
    mutationFn: () => apiPost(`/finance/bills/${bill.id}/payments`, { amountMinor: Math.round(Number(amount) * 100) }),
    onSuccess: () => {
      toast.success('Payment recorded', { description: bill.number });
      qc.invalidateQueries({ queryKey: ['bills'] });
      setOpen(false);
      setAmount('');
    },
    onError: (e) => toast.error('Could not record payment', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    pay.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setAmount((bill.outstanding.amountMinor / 100).toString()); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Banknote className="size-4" /> Pay</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay bill {bill.number}</DialogTitle>
          <DialogDescription>
            Outstanding {formatMoney(bill.outstanding.amountMinor, bill.outstanding.currency)} to {bill.vendorName ?? 'vendor'}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amt">Amount</Label>
            <Input id="amt" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pay.isPending}>{pay.isPending ? 'Saving…' : 'Record payment'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
