'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { DocStatusBadge, fmtDate } from './inv-ui';

interface Money { amountMinor: number; currency: string }
interface PostedItem { id: string; productId: string; sku: string; name: string; qty: number; returnedQty?: number; unitCost: Money }
interface Grn { id: string; grnNo: string; status: string; receivedOn: string | null; notes: string | null; poNo: string | null; vendor: string | null; warehouse: string | null; items: PostedItem[] }
interface Issue { id: string; issueNo: string; status: string; issuedOn: string | null; issuedTo: string | null; department: string | null; notes: string | null; reqNo: string | null; warehouse: string | null; items: PostedItem[] }
interface Mrn { id: string; mrnNo: string; status: string; returnedOn: string | null; returnedBy: string | null; notes: string | null; issueNo: string | null; warehouse: string | null; items: PostedItem[] }
type PostedDoc = Grn | Issue | Mrn;

const SEGMENTS = { grn: 'grns', issue: 'issues', mrn: 'mrns' } as const;
const NOT_FOUND = { grn: 'Goods receipt not found.', issue: 'Issue not found.', mrn: 'Material return not found.' } as const;

/** Read-only detail for a posted document (GRN / issue / MRN), sized for the three-pane detail column. */
export function PostedDocDetail({ kind, id, onBack }: { kind: 'grn' | 'issue' | 'mrn'; id: string; onBack?: () => void }) {
  const seg = SEGMENTS[kind];
  const doc = useQuery({ queryKey: [kind, id], queryFn: () => apiGet<PostedDoc>(`/inventory/${seg}/${id}`) });

  if (doc.isLoading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (doc.isError || !doc.data) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{NOT_FOUND[kind]}</div>;
  const d = doc.data;

  const docNo = kind === 'grn' ? (d as Grn).grnNo : kind === 'issue' ? (d as Issue).issueNo : (d as Mrn).mrnNo;
  const date = kind === 'grn' ? (d as Grn).receivedOn : kind === 'issue' ? (d as Issue).issuedOn : (d as Mrn).returnedOn;

  let tiles: Array<{ label: string; value: string }>;
  if (kind === 'grn') {
    const g = d as Grn;
    tiles = [
      { label: 'PO', value: g.poNo ?? '—' },
      { label: 'Vendor', value: g.vendor ?? '—' },
      { label: 'Warehouse', value: g.warehouse ?? '—' },
      { label: 'Received', value: fmtDate(date) },
    ];
  } else if (kind === 'issue') {
    const i = d as Issue;
    tiles = [
      { label: 'Requisition', value: i.reqNo ?? '—' },
      { label: 'Issued to', value: i.issuedTo ?? '—' },
      { label: 'Department', value: i.department ?? '—' },
      { label: 'Warehouse', value: i.warehouse ?? '—' },
      { label: 'Issued', value: fmtDate(date) },
    ];
  } else {
    const m = d as Mrn;
    tiles = [
      { label: 'Issue', value: m.issueNo ?? '—' },
      { label: 'Returned by', value: m.returnedBy ?? '—' },
      { label: 'Warehouse', value: m.warehouse ?? '—' },
      { label: 'Returned', value: fmtDate(date) },
    ];
  }

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{docNo}</span><DocStatusBadge status={d.status} /></div>
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => <Tile key={t.label} label={t.label} value={t.value} />)}
          {d.notes ? <Tile label="Notes" value={d.notes} /> : null}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit cost</th><th className="px-3 py-2 text-right">Line value</th></tr>
              </thead>
              <tbody className="divide-y">
                {d.items.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No items.</td></tr>
                ) : d.items.map((it) => (
                  <tr key={it.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5"><div className="font-medium">{it.name}</div><div className="text-xs text-muted-foreground">{it.sku}</div></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{it.qty}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(it.unitCost.amountMinor, it.unitCost.currency)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(it.qty * it.unitCost.amountMinor, it.unitCost.currency)}</td>
                  </tr>
                ))}
              </tbody>
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
