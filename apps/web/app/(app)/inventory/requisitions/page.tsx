'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { Product, Requisition } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS: Record<Requisition['status'], 'secondary' | 'warning' | 'success' | 'destructive'> = {
  DRAFT: 'secondary', SUBMITTED: 'warning', APPROVED: 'success', ISSUED: 'success', CANCELLED: 'destructive',
};

export default function RequisitionsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['requisitions'], queryFn: () => apiGet<Requisition[]>('/inventory/requisitions') });
  const rows = data ?? [];

  const action = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: string }) => apiPost(`/inventory/requisitions/${id}/${verb}`),
    onSuccess: (_r, v) => { toast.success(`Requisition ${v.verb}`); qc.invalidateQueries({ queryKey: ['requisitions'] }); },
    onError: (e) => toast.error('Action failed', { description: e instanceof ApiError ? e.message : '' }),
  });
  const issue = useMutation({
    mutationFn: (id: string) => apiPost<{ issueNo?: string }>('/inventory/issues', { requisitionId: id }),
    onSuccess: (r: { issueNo?: string }) => { toast.success(`Issued (${r.issueNo})`); qc.invalidateQueries({ queryKey: ['requisitions'] }); qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e) => toast.error('Issue failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Inventory" description="Material requisitions." action={<NewRequisitionDialog />} />
      <InventoryTabs />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requisition</TableHead><TableHead>Requested by</TableHead><TableHead>Items</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.req_no}</TableCell>
                <TableCell>{r.requested_by ?? '—'}{r.department ? <span className="text-xs text-muted-foreground"> · {r.department}</span> : null}</TableCell>
                <TableCell className="tabular-nums">{r.item_count}</TableCell>
                <TableCell><Badge variant={STATUS[r.status]}>{r.status}</Badge></TableCell>
                <TableCell className="text-right space-x-2">
                  {r.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => action.mutate({ id: r.id, verb: 'submit' })}>Submit</Button>}
                  {r.status === 'SUBMITTED' && <Button size="sm" variant="outline" onClick={() => action.mutate({ id: r.id, verb: 'approve' })}>Approve</Button>}
                  {r.status === 'APPROVED' && <Button size="sm" onClick={() => issue.mutate(r.id)}>Issue</Button>}
                  {(r.status === 'DRAFT' || r.status === 'SUBMITTED' || r.status === 'APPROVED') && <Button size="sm" variant="ghost" onClick={() => action.mutate({ id: r.id, verb: 'cancel' })}>Cancel</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!isLoading && rows.length === 0 ? <div className="p-4"><EmptyState icon={ClipboardList} title="No requisitions" description="Raise a material requisition." action={<NewRequisitionDialog />} /></div> : null}
      </Card>
    </div>
  );
}

function NewRequisitionDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [requestedBy, setRequestedBy] = useState('');
  const [department, setDepartment] = useState('');
  const [lines, setLines] = useState<{ productId: string; qty: string }[]>([{ productId: '', qty: '1' }]);
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => apiGet<Product[]>('/inventory/products'), enabled: open });

  const create = useMutation({
    mutationFn: () => apiPost('/inventory/requisitions', {
      requestedBy: requestedBy || undefined, department: department || undefined,
      items: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, qty: Number(l.qty) })),
    }),
    onSuccess: () => {
      toast.success('Requisition created');
      qc.invalidateQueries({ queryKey: ['requisitions'] });
      setOpen(false); setRequestedBy(''); setDepartment(''); setLines([{ productId: '', qty: '1' }]);
    },
    onError: (e) => toast.error('Could not create', { description: e instanceof ApiError ? e.message : '' }),
  });
  const valid = lines.some((l) => l.productId && Number(l.qty) > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> New requisition</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New requisition</DialogTitle><DialogDescription>Request materials from a store.</DialogDescription></DialogHeader>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Requested by</Label><Input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="Line 1" /></div>
            <div className="space-y-2"><Label>Department</Label><Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Production" /></div>
          </div>
          <div className="space-y-2">
            <Label>Items</Label>
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Select value={l.productId} onValueChange={(v) => setLines((s) => s.map((x, j) => j === i ? { ...x, productId: v } : x))}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Product" /></SelectTrigger>
                  <SelectContent>{(products ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} · {p.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="w-24" type="number" min="1" value={l.qty} onChange={(e) => setLines((s) => s.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                {lines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((s) => [...s, { productId: '', qty: '1' }])}><Plus className="size-4" /> Add line</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? 'Saving…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
