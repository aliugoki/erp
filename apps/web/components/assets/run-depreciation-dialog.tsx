'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import type { AssetDepreciationRun } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
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

function endOfThisMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export function RunDepreciationDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(endOfThisMonth());
  const [notes, setNotes] = useState('');

  const run = useMutation({
    mutationFn: () => apiPost<AssetDepreciationRun>('/assets/depreciation/run', { period, ...(notes ? { notes } : {}) }),
    onSuccess: (r) => {
      toast.success(`Depreciation posted: ${r.assetCount} asset(s), ${formatMoney(r.total.amountMinor, r.total.currency)}`);
      qc.invalidateQueries({ queryKey: ['asset-runs'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset-register'] });
      setOpen(false);
      setNotes('');
    },
    onError: (e) => toast.error('Could not run depreciation', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Play className="mr-1 h-4 w-4" /> Run depreciation</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run depreciation</DialogTitle>
          <DialogDescription>Posts one depreciation entry per eligible active asset for the period (idempotent — a period is never depreciated twice).</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="period">Period end</Label>
            <Input id="period" type="date" value={period} onChange={(e) => setPeriod(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rn">Notes</Label>
            <Input id="rn" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={run.isPending}>{run.isPending ? 'Posting…' : 'Post depreciation'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
