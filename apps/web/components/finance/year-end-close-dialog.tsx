'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, FiscalPeriod } from '@/lib/types';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Year-end close: roll the period's revenue & expense into a retained-earnings equity account. */
export function YearEndCloseDialog({ period }: { period: FiscalPeriod }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reId, setReId] = useState('');

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), enabled: open });
  const equity = (accounts ?? []).filter((a) => !a.isGroup && a.type === 'EQUITY');

  const close = useMutation({
    mutationFn: () => apiPost<{ posted: boolean; voucherNo: string | null; netIncomeMinor: number; message?: string }>('/finance/year-end-close', { periodId: period.id, retainedEarningsAccountId: reId }),
    onSuccess: (r) => {
      if (!r.posted) toast.info('Nothing to close', { description: r.message });
      else toast.success(`Year closed — ${r.voucherNo}`, { description: `Net income ${formatMoney(r.netIncomeMinor)} → retained earnings` });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setOpen(false);
      setReId('');
    },
    onError: (e) => toast.error('Close failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    close.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><Archive className="size-4" /> Close year</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Year-end close · {period.name}</DialogTitle>
          <DialogDescription>
            Posts a closing voucher dated {String(period.endDate).slice(0, 10)} that zeroes all revenue &amp; expense and
            rolls the net result into the chosen retained-earnings account.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Retained earnings (equity account)</Label>
            <Select value={reId} onValueChange={setReId}>
              <SelectTrigger><SelectValue placeholder="Select equity account" /></SelectTrigger>
              <SelectContent>
                {equity.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {equity.length === 0 ? <p className="text-xs text-muted-foreground">Create a postable EQUITY account first.</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!reId || close.isPending}>{close.isPending ? 'Closing…' : 'Close year'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
