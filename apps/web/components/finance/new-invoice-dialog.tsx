'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Account, CrmClient } from '@/lib/types';
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

export function NewInvoiceDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ number: '', description: '', quantity: '1', unitPrice: '', tax: '0', clientId: 'NONE', incomeAccountId: 'NONE' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: clients } = useQuery({ queryKey: ['crm-clients'], queryFn: () => apiGet<CrmClient[]>('/crm/clients'), enabled: open });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), enabled: open });
  const incomeAccts = (accounts ?? []).filter((a) => !a.isGroup && a.type === 'REVENUE');

  const subtotal = (Number(f.quantity) || 0) * Math.round((Number(f.unitPrice) || 0) * 100);
  const total = subtotal + Math.round((Number(f.tax) || 0) * 100);

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ journalNo: string | null }>('/finance/invoices', {
        number: f.number,
        lineItems: [{ description: f.description, quantity: Number(f.quantity), unitPriceMinor: Math.round(Number(f.unitPrice) * 100) }],
        taxMinor: Math.round(Number(f.tax) * 100),
        ...(f.clientId !== 'NONE' ? { clientId: f.clientId } : {}),
        ...(f.clientId !== 'NONE' && f.incomeAccountId !== 'NONE' ? { incomeAccountId: f.incomeAccountId } : {}),
      }),
    onSuccess: (r) => {
      toast.success('Invoice created', { description: r.journalNo ? `Posted to GL as ${r.journalNo}` : f.number });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setOpen(false);
      setF({ number: '', description: '', quantity: '1', unitPrice: '', tax: '0', clientId: 'NONE', incomeAccountId: 'NONE' });
    },
    onError: (e) => toast.error('Could not create invoice', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New invoice
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>All amounts are stored as exact integer minor units.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="num">Invoice number</Label>
            <Input id="num" value={f.number} onChange={(e) => set('number')(e.target.value)} placeholder="INV-1001" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Line item</Label>
            <Input id="desc" value={f.description} onChange={(e) => set('description')(e.target.value)} placeholder="Consulting services" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qty">Qty</Label>
              <Input id="qty" type="number" min="1" value={f.quantity} onChange={(e) => set('quantity')(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="up">Unit price</Label>
              <Input id="up" type="number" min="0" step="0.01" value={f.unitPrice} onChange={(e) => set('unitPrice')(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx">Tax</Label>
              <Input id="tx" type="number" min="0" step="0.01" value={f.tax} onChange={(e) => set('tax')(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Client <span className="text-xs text-muted-foreground">(for GL posting)</span></Label>
              <Select value={f.clientId} onValueChange={set('clientId')}>
                <SelectTrigger><SelectValue placeholder="No client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— No client —</SelectItem>
                  {(clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Post to GL <span className="text-xs text-muted-foreground">(income)</span></Label>
              <Select value={f.incomeAccountId} onValueChange={set('incomeAccountId')} disabled={f.clientId === 'NONE'}>
                <SelectTrigger><SelectValue placeholder="Don't post" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— Don&apos;t post —</SelectItem>
                  {incomeAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create invoice'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
