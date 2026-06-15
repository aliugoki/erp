'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { GrnRow, IssueRow, MrnRow } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function RegistersPage() {
  const { data: grns } = useQuery({ queryKey: ['grns'], queryFn: () => apiGet<GrnRow[]>('/inventory/grns') });
  const { data: issues } = useQuery({ queryKey: ['issues'], queryFn: () => apiGet<IssueRow[]>('/inventory/issues') });
  const { data: mrns } = useQuery({ queryKey: ['mrns'], queryFn: () => apiGet<MrnRow[]>('/inventory/mrns') });

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Inventory" description="Document registers — GRNs, issuances and returns." />
      <InventoryTabs />

      <Card className="p-4">
        <p className="mb-3 font-medium">Goods Receipt Notes</p>
        <Table>
          <TableHeader><TableRow><TableHead>GRN #</TableHead><TableHead>PO</TableHead><TableHead>Vendor</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
          <TableBody>
            {(grns ?? []).map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">{g.grn_no}</TableCell>
                <TableCell>{g.po_no ?? '—'}</TableCell>
                <TableCell>{g.vendor ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{g.received_on ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{g.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(g.value_minor)}</TableCell>
              </TableRow>
            ))}
            {grns && grns.length === 0 ? <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No goods receipts yet.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4">
        <p className="mb-3 font-medium">Store Issuances</p>
        <Table>
          <TableHeader><TableRow><TableHead>Issue #</TableHead><TableHead>Requisition</TableHead><TableHead>Issued to</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
          <TableBody>
            {(issues ?? []).map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.issue_no}</TableCell>
                <TableCell>{i.req_no ?? '—'}</TableCell>
                <TableCell>{i.issued_to ?? '—'}{i.department ? <span className="text-xs text-muted-foreground"> · {i.department}</span> : null}</TableCell>
                <TableCell className="text-muted-foreground">{i.issued_on ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.value_minor)}</TableCell>
              </TableRow>
            ))}
            {issues && issues.length === 0 ? <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No issuances yet.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4">
        <p className="mb-3 font-medium">Material Return Notes</p>
        <Table>
          <TableHeader><TableRow><TableHead>MRN #</TableHead><TableHead>Against issue</TableHead><TableHead>Returned by</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
          <TableBody>
            {(mrns ?? []).map((n) => (
              <TableRow key={n.id}>
                <TableCell className="font-medium">{n.mrn_no}</TableCell>
                <TableCell>{n.issue_no ?? '—'}</TableCell>
                <TableCell>{n.returned_by ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{n.returned_on ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{n.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(n.value_minor)}</TableCell>
              </TableRow>
            ))}
            {mrns && mrns.length === 0 ? <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No returns yet.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
