'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { GatePass } from '@/lib/types';
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

export default function GatePassesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['gate-passes'], queryFn: () => apiGet<GatePass[]>('/inventory/gate-passes') });
  const rows = data ?? [];

  const close = useMutation({
    mutationFn: (id: string) => apiPost(`/inventory/gate-passes/${id}/close`),
    onSuccess: () => { toast.success('Gate pass closed'); qc.invalidateQueries({ queryKey: ['gate-passes'] }); },
    onError: (e) => toast.error('Action failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Inventory" description="Gate passes — inward / outward goods movement." action={<NewGatePassDialog />} />
      <InventoryTabs />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Gate pass</TableHead><TableHead>Direction</TableHead><TableHead>Party</TableHead>
              <TableHead>Items</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && rows.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">{g.gp_no}</TableCell>
                <TableCell><Badge variant={g.direction === 'INWARD' ? 'success' : 'secondary'}>{g.direction}</Badge>{g.returnable ? <span className="ml-2 text-xs text-muted-foreground">returnable</span> : null}</TableCell>
                <TableCell>{g.party ?? '—'}{g.vehicle_no ? <span className="text-xs text-muted-foreground"> · {g.vehicle_no}</span> : null}</TableCell>
                <TableCell className="tabular-nums">{g.item_count}</TableCell>
                <TableCell><Badge variant={g.status === 'OPEN' ? 'warning' : g.status === 'CLOSED' ? 'success' : 'destructive'}>{g.status}</Badge></TableCell>
                <TableCell className="text-right">{g.status === 'OPEN' && <Button size="sm" variant="outline" onClick={() => close.mutate(g.id)}>Close</Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!isLoading && rows.length === 0 ? <div className="p-4"><EmptyState icon={DoorOpen} title="No gate passes" description="Record an inward or outward gate pass." action={<NewGatePassDialog />} /></div> : null}
      </Card>
    </div>
  );
}

function NewGatePassDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ direction: 'OUTWARD', returnable: false, party: '', vehicleNo: '' });
  const [lines, setLines] = useState<{ description: string; qty: string }[]>([{ description: '', qty: '1' }]);

  const create = useMutation({
    mutationFn: () => apiPost('/inventory/gate-passes', {
      direction: f.direction, returnable: f.returnable, party: f.party || undefined, vehicleNo: f.vehicleNo || undefined,
      items: lines.filter((l) => l.description).map((l) => ({ description: l.description, qty: Number(l.qty) })),
    }),
    onSuccess: () => {
      toast.success('Gate pass created');
      qc.invalidateQueries({ queryKey: ['gate-passes'] });
      setOpen(false); setF({ direction: 'OUTWARD', returnable: false, party: '', vehicleNo: '' }); setLines([{ description: '', qty: '1' }]);
    },
    onError: (e) => toast.error('Could not create', { description: e instanceof ApiError ? e.message : '' }),
  });
  const valid = lines.some((l) => l.description && Number(l.qty) > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> New gate pass</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New gate pass</DialogTitle><DialogDescription>Record goods moving in or out of the gate.</DialogDescription></DialogHeader>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={f.direction} onValueChange={(v) => setF((s) => ({ ...s, direction: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="INWARD">Inward</SelectItem><SelectItem value="OUTWARD">Outward</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <input id="ret" type="checkbox" className="size-4 accent-primary" checked={f.returnable} onChange={(e) => setF((s) => ({ ...s, returnable: e.target.checked }))} />
              <Label htmlFor="ret">Returnable</Label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Party</Label><Input value={f.party} onChange={(e) => setF((s) => ({ ...s, party: e.target.value }))} placeholder="Workshop" /></div>
            <div className="space-y-2"><Label>Vehicle #</Label><Input value={f.vehicleNo} onChange={(e) => setF((s) => ({ ...s, vehicleNo: e.target.value }))} placeholder="LEX-1234" /></div>
          </div>
          <div className="space-y-2">
            <Label>Items</Label>
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Input className="flex-1" value={l.description} onChange={(e) => setLines((s) => s.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder="Description" />
                <Input className="w-24" type="number" min="1" value={l.qty} onChange={(e) => setLines((s) => s.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                {lines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((s) => [...s, { description: '', qty: '1' }])}><Plus className="size-4" /> Add line</Button>
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
