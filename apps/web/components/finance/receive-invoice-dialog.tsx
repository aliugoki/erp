'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { Account, Invoice } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Mark an invoice paid, optionally posting the receipt to the GL (Dr cash·bank / Cr receivable). */
export function ReceiveInvoiceDialog({ invoice }: { invoice: Invoice }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [into, setInto] = useState('NONE');

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), enabled: open });
  const cashBank = (accounts ?? []).filter((a) => a.controlType === 'CASH' || a.controlType === 'BANK');

  const pay = useMutation({
    mutationFn: () => apiPatch<{ journalNo: string | null }>(`/finance/invoices/${invoice.id}/pay`, into !== 'NONE' ? { paymentAccountId: into } : {}),
    onSuccess: (r) => {
      toast.success('Invoice marked paid', { description: r.journalNo ? `Receipt posted as ${r.journalNo}` : 'A finance.invoice_paid event was emitted.' });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setOpen(false);
      setInto('NONE');
    },
    onError: (e) => toast.error('Payment failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); pay.mutate(); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><CheckCircle2 className="size-4" /> Mark paid</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive invoice {invoice.number}</DialogTitle>
          <DialogDescription>{formatMoney(invoice.total.amountMinor, invoice.total.currency)} — optionally post the receipt to the ledger.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Receive into <span className="text-xs text-muted-foreground">(optional — Dr cash·bank / Cr receivable)</span></Label>
            <Select value={into} onValueChange={setInto}>
              <SelectTrigger><SelectValue placeholder="Don't post to the ledger" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">— Don&apos;t post —</SelectItem>
                {cashBank.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name} ({a.controlType})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pay.isPending}>{pay.isPending ? 'Saving…' : 'Mark paid'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
