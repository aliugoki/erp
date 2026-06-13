'use client';
import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, Frequency, VoucherType } from '@/lib/types';
import { VOUCHER_TYPES } from '@/lib/finance';
import { cn, formatMoney } from '@/lib/utils';
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

interface Line { accountId: string; debit: string; credit: string }
const emptyLine = (): Line => ({ accountId: '', debit: '', credit: '' });
const toMinor = (v: string) => Math.round((Number(v) || 0) * 100);
const FREQS: Frequency[] = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

export function NewRecurringDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hdr, setHdr] = useState({ description: '', voucherType: 'JV' as VoucherType, frequency: 'MONTHLY' as Frequency, nextRunDate: '', endDate: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), enabled: open });
  const postable = (accounts ?? []).filter((a) => !a.isGroup);

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) { d += toMinor(l.debit); c += toMinor(l.credit); }
    return { d, c, balanced: d === c && d > 0 };
  }, [lines]);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const valid = totals.balanced && hdr.description && hdr.nextRunDate && lines.every((l) => l.accountId && (toMinor(l.debit) > 0) !== (toMinor(l.credit) > 0));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/finance/recurring', {
        description: hdr.description,
        voucherType: hdr.voucherType,
        frequency: hdr.frequency,
        nextRunDate: hdr.nextRunDate,
        ...(hdr.endDate ? { endDate: hdr.endDate } : {}),
        entries: lines.map((l) => ({ accountId: l.accountId, ...(toMinor(l.debit) > 0 ? { debitMinor: toMinor(l.debit) } : { creditMinor: toMinor(l.credit) }) })),
      }),
    onSuccess: () => {
      toast.success('Recurring voucher saved', { description: hdr.description });
      qc.invalidateQueries({ queryKey: ['recurring'] });
      setOpen(false);
      setHdr({ description: '', voucherType: 'JV', frequency: 'MONTHLY', nextRunDate: '', endDate: '' });
      setLines([emptyLine(), emptyLine()]);
    },
    onError: (e) => toast.error('Could not save', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); create.mutate(); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> New recurring</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New recurring voucher</DialogTitle>
          <DialogDescription>A balanced template that generates a voucher each period.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rd">Description</Label>
              <Input id="rd" value={hdr.description} onChange={(e) => setHdr((s) => ({ ...s, description: e.target.value }))} placeholder="Monthly office rent" required />
            </div>
            <div className="space-y-2">
              <Label>Voucher type</Label>
              <Select value={hdr.voucherType} onValueChange={(v) => setHdr((s) => ({ ...s, voucherType: v as VoucherType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{VOUCHER_TYPES.map((v) => <SelectItem key={v.value} value={v.value}>{v.value} — {v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select value={hdr.frequency} onValueChange={(v) => setHdr((s) => ({ ...s, frequency: v as Frequency }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FREQS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nr">Next run</Label>
              <Input id="nr" type="date" value={hdr.nextRunDate} onChange={(e) => setHdr((s) => ({ ...s, nextRunDate: e.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed">End (optional)</Label>
              <Input id="ed" type="date" value={hdr.endDate} onChange={(e) => setHdr((s) => ({ ...s, endDate: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_7rem_7rem_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground">
              <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_7rem_2rem] items-center gap-2">
                <Select value={l.accountId} onValueChange={(v) => setLine(i, { accountId: v })}>
                  <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>{postable.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" className="text-right" placeholder="0.00" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                <Input type="number" min="0" step="0.01" className="text-right" placeholder="0.00" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                <Button type="button" variant="ghost" size="icon" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Plus className="size-4" /> Add line</Button>
          </div>

          <div className={cn('flex items-center justify-between rounded-lg px-4 py-3 text-sm', totals.balanced ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted/50')}>
            <span className="font-medium">{totals.balanced ? 'Balanced ✓' : 'Out of balance'}</span>
            <span className="tabular-nums">Dr {formatMoney(totals.d)} · Cr {formatMoney(totals.c)}</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? 'Saving…' : 'Save recurring'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
