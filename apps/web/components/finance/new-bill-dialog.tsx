'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, Vendor } from '@/lib/types';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function NewBillDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ number: '', vendorId: '', description: '', quantity: '1', unitPrice: '', tax: '0', dueDate: '', expenseAccountId: 'NONE' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: vendors } = useQuery({ queryKey: ['vendors'], queryFn: () => apiGet<Vendor[]>('/finance/vendors'), enabled: open });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), enabled: open });
  const expenseAccts = (accounts ?? []).filter((a) => !a.isGroup && a.type === 'EXPENSE');

  const subtotal = (Number(f.quantity) || 0) * Math.round((Number(f.unitPrice) || 0) * 100);
  const total = subtotal + Math.round((Number(f.tax) || 0) * 100);

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ journalNo: string | null }>('/finance/bills', {
        number: f.number,
        vendorId: f.vendorId,
        lineItems: [{ description: f.description, quantity: Number(f.quantity), unitPriceMinor: Math.round(Number(f.unitPrice) * 100) }],
        taxMinor: Math.round(Number(f.tax) * 100),
        ...(f.dueDate ? { dueDate: f.dueDate } : {}),
        ...(f.expenseAccountId !== 'NONE' ? { expenseAccountId: f.expenseAccountId } : {}),
      }),
    onSuccess: (r) => {
      toast.success('Bill recorded', { description: r.journalNo ? `Posted to GL as ${r.journalNo}` : f.number });
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setOpen(false);
      setF({ number: '', vendorId: '', description: '', quantity: '1', unitPrice: '', tax: '0', dueDate: '', expenseAccountId: 'NONE' });
    },
    onError: (e) => toast.error('Could not record bill', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> New bill</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record vendor bill</DialogTitle>
          <DialogDescription>A purchase invoice you owe a vendor.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bnum">Bill number</Label>
              <Input id="bnum" value={f.number} onChange={(e) => set('number')(e.target.value)} placeholder="BILL-1001" required />
            </div>
            <div className="space-y-2">
              <Label>Vendor</Label>
              <Select value={f.vendorId} onValueChange={set('vendorId')}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  {(vendors ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bdesc">Line item</Label>
            <Input id="bdesc" value={f.description} onChange={(e) => set('description')(e.target.value)} placeholder="Raw materials" required />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bq">Qty</Label>
              <Input id="bq" type="number" min="1" value={f.quantity} onChange={(e) => set('quantity')(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bup">Unit price</Label>
              <Input id="bup" type="number" min="0" step="0.01" value={f.unitPrice} onChange={(e) => set('unitPrice')(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="btx">Tax</Label>
              <Input id="btx" type="number" min="0" step="0.01" value={f.tax} onChange={(e) => set('tax')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bdue">Due</Label>
              <Input id="bdue" type="date" value={f.dueDate} onChange={(e) => set('dueDate')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Post to GL <span className="text-xs text-muted-foreground">(optional — Dr expense / Cr vendor payable)</span></Label>
            <Select value={f.expenseAccountId} onValueChange={set('expenseAccountId')}>
              <SelectTrigger><SelectValue placeholder="Don't post to the ledger" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">— Don&apos;t post —</SelectItem>
                {expenseAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!f.vendorId || create.isPending}>{create.isPending ? 'Saving…' : 'Record bill'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
