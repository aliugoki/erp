'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, UserPlus } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import type { Lead } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { CrmTabs } from '@/components/crm/crm-tabs';
import { NewLeadDialog } from '@/components/crm/new-lead-dialog';
import { ConvertLeadDialog } from '@/components/crm/convert-lead-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const RATING_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary'> = {
  HOT: 'destructive',
  WARM: 'warning',
  COLD: 'secondary',
};
const STATUS_VARIANT: Record<string, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  NEW: 'secondary',
  CONTACTED: 'warning',
  QUALIFIED: 'success',
  UNQUALIFIED: 'destructive',
  CONVERTED: 'success',
};
const OPEN_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED'];

export default function LeadsPage() {
  const qc = useQueryClient();
  const [converting, setConverting] = useState<Lead | null>(null);
  const { data: leads, isLoading } = useQuery({ queryKey: ['leads'], queryFn: () => apiGet<Lead[]>('/crm/leads') });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/crm/leads/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  const list = leads ?? [];
  const open = list.filter((l) => l.status !== 'CONVERTED');
  const hot = list.filter((l) => l.rating === 'HOT' && l.status !== 'CONVERTED').length;
  const converted = list.filter((l) => l.status === 'CONVERTED').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="CRM" description="Capture, qualify and convert prospective buyers." action={<NewLeadDialog />} />
      <CrmTabs />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={UserPlus} label="Open leads" value={open.length} accent="primary" delayMs={0} />
        <StatCard icon={Flame} label="Hot leads" value={hot} accent="warning" delayMs={60} />
        <StatCard icon={UserPlus} label="Converted" value={converted} accent="success" delayMs={120} />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Est. value</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{l.leadNo}</span>
                    {l.company ? ` · ${l.company}` : ''}
                    {l.source ? ` · ${l.source}` : ''}
                  </p>
                </TableCell>
                <TableCell><Badge variant={RATING_VARIANT[l.rating]}>{l.rating}</Badge></TableCell>
                <TableCell className="tabular-nums">{formatMoney(l.estValue.amountMinor, l.estValue.currency)}</TableCell>
                <TableCell>
                  {l.status === 'CONVERTED' ? (
                    <Badge variant="success">Converted</Badge>
                  ) : (
                    <Select value={l.status} onValueChange={(status) => setStatus.mutate({ id: l.id, status })}>
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPEN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {l.status === 'CONVERTED' ? (
                    <Badge variant={STATUS_VARIANT.CONVERTED}>✓</Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setConverting(l)}>Convert</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!isLoading && list.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={UserPlus} title="No leads yet" description="Capture your first lead to start the funnel." action={<NewLeadDialog />} />
          </div>
        ) : null}
      </Card>

      <ConvertLeadDialog lead={converting} onClose={() => setConverting(null)} />
    </div>
  );
}
