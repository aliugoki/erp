'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { StatusBadge, fmtDate } from './fin-ui';

interface TxEntry {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  currency: string;
  costCenterCode: string | null;
}
interface TransactionDetailData {
  id: string;
  description: string | null;
  voucherType: string;
  voucherNo: string | null;
  status: string;
  occurredOn: string | null;
  reference: string | null;
  entries: TxEntry[];
}

/** Transaction (voucher) detail + post/reverse/delete actions, sized for the three-pane detail column. */
export function TransactionDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const qc = useQueryClient();
  const tx = useQuery({ queryKey: ['transaction', id], queryFn: () => apiGet<TransactionDetailData>(`/finance/transactions/${id}`) });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['transactions'] });
    void qc.invalidateQueries({ queryKey: ['transaction', id] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const post = useMutation({ mutationFn: () => apiPost(`/finance/transactions/${id}/post`, {}), onSuccess: () => { toast.success('Posted'); invalidate(); }, onError: onErr });
  const reverse = useMutation({ mutationFn: () => apiPost(`/finance/transactions/${id}/reverse`, {}), onSuccess: () => { toast.success('Reversed'); invalidate(); }, onError: onErr });
  const remove = useMutation({ mutationFn: () => apiDelete(`/finance/transactions/${id}`), onSuccess: () => { toast.success('Deleted'); invalidate(); onBack?.(); }, onError: onErr });

  if (tx.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (tx.isError || !tx.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Transaction not found.</div>;
  const t = tx.data;
  const entries = t.entries ?? [];
  const totalDebit = entries.reduce((s, e) => s + e.debitMinor, 0);
  const totalCredit = entries.reduce((s, e) => s + e.creditMinor, 0);

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{t.voucherNo ?? 'Draft'}</span><StatusBadge status={t.status} /></div>
        <span className="text-xs font-semibold text-muted-foreground">{t.voucherType}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {t.status === 'DRAFT' ? <Button size="sm" onClick={() => post.mutate()} disabled={post.isPending}><Check className="mr-1.5 h-4 w-4" /> Post</Button> : null}
          {t.status === 'DRAFT' ? <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this draft transaction?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button> : null}
          {t.status === 'POSTED' ? <Button variant="outline" size="sm" onClick={() => reverse.mutate()} disabled={reverse.isPending}><RotateCcw className="mr-1.5 h-4 w-4" /> Reverse</Button> : null}
        </div>
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Description" value={t.description ?? '—'} />
          <Tile label="Date" value={fmtDate(t.occurredOn)} />
          <Tile label="Reference" value={t.reference ?? '—'} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entries</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2">Cost center</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr>
              </thead>
              <tbody className="divide-y">
                {entries.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No entries.</td></tr>
                ) : entries.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5"><div className="font-medium">{e.accountName}</div><div className="font-mono text-xs text-muted-foreground">{e.accountCode}</div></td>
                    <td className="px-3 py-2.5 text-muted-foreground">{e.costCenterCode ?? ''}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.debitMinor > 0 ? formatMoney(e.debitMinor, 'PKR') : ''}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.creditMinor > 0 ? formatMoney(e.creditMinor, 'PKR') : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="px-3 py-2.5" colSpan={2}>Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(totalDebit, 'PKR')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(totalCredit, 'PKR')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </PaneBody>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}
