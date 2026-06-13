'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, FiscalPeriod } from '@/lib/types';
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

/** Set (upsert) the budget for an account in a period. `periodId` preselects the report's period. */
export function SetBudgetDialog({ periodId }: { periodId?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ periodId: periodId ?? '', accountId: '', amount: '' });

  const { data: periods } = useQuery({ queryKey: ['periods'], queryFn: () => apiGet<FiscalPeriod[]>('/finance/periods'), enabled: open });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), enabled: open });
  // Budgets are most meaningful for P&L (revenue/expense) postable accounts.
  const pnl = (accounts ?? []).filter((a) => !a.isGroup && (a.type === 'REVENUE' || a.type === 'EXPENSE'));

  const save = useMutation({
    mutationFn: () => apiPost('/finance/budgets', { periodId: f.periodId, accountId: f.accountId, amountMinor: Math.round(Number(f.amount) * 100) }),
    onSuccess: () => {
      toast.success('Budget set');
      qc.invalidateQueries({ queryKey: ['reports', 'budget'] });
      setOpen(false);
      setF({ periodId: periodId ?? '', accountId: '', amount: '' });
    },
    onError: (e) => toast.error('Could not set budget', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setF((s) => ({ ...s, periodId: periodId ?? s.periodId })); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Target className="size-4" /> Set budget</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set budget</DialogTitle>
          <DialogDescription>Planned amount for an account in a fiscal period.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Period</Label>
            <Select value={f.periodId} onValueChange={(v) => setF((s) => ({ ...s, periodId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger>
              <SelectContent>
                {(periods ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Account</Label>
            <Select value={f.accountId} onValueChange={(v) => setF((s) => ({ ...s, accountId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select P&L account" /></SelectTrigger>
              <SelectContent>
                {pnl.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name} ({a.type})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amt">Budget amount</Label>
            <Input id="amt" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!f.periodId || !f.accountId || save.isPending}>{save.isPending ? 'Saving…' : 'Set budget'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
