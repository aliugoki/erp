'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
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
import { Label } from '@/components/ui/label';

/** Paste statement rows as `date,amount,description` (amount: + deposit / − payment). */
export function ImportStatementDialog({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const parse = () =>
    text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [date, amount, ...rest] = l.split(',');
      return { date: date?.trim(), amountMinor: Math.round(Number(amount) * 100), description: rest.join(',').trim() || undefined };
    }).filter((r) => r.date && Number.isFinite(r.amountMinor));

  const imp = useMutation({
    mutationFn: () => apiPost<{ imported: number }>('/finance/bank-statements/import', { accountId, lines: parse() }),
    onSuccess: (r) => {
      toast.success(`Imported ${r.imported} line(s)`);
      qc.invalidateQueries({ queryKey: ['statement'] });
      setOpen(false);
      setText('');
    },
    onError: (e) => toast.error('Import failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); imp.mutate(); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Upload className="size-4" /> Import statement</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import bank statement</DialogTitle>
          <DialogDescription>One row per line: <code>date,amount,description</code> — amount is + for deposits, − for payments.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stmt">Statement rows</Label>
            <textarea
              id="stmt"
              className="h-40 w-full rounded-md border bg-transparent p-2 font-mono text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'2026-06-15,12000.00,Customer deposit\n2026-06-16,-4500.00,Salaries'}
            />
            <p className="text-xs text-muted-foreground">{parse().length} valid row(s) detected.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={parse().length === 0 || imp.isPending}>{imp.isPending ? 'Importing…' : 'Import'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
