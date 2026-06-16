'use client';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { CrmAccount } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { CrmTabs } from '@/components/crm/crm-tabs';
import { NewAccountDialog } from '@/components/crm/new-account-dialog';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'warning'> = {
  PROSPECT: 'warning',
  ACTIVE: 'success',
  INACTIVE: 'secondary',
};

export default function AccountsPage() {
  const { data: accounts, isLoading } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<CrmAccount[]>('/crm/clients') });
  const list = accounts ?? [];
  const active = list.filter((a) => a.status === 'ACTIVE').length;
  const prospects = list.filter((a) => a.status === 'PROSPECT').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="CRM" description="The companies you sell to." action={<NewAccountDialog />} />
      <CrmTabs />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Building2} label="Accounts" value={list.length} accent="primary" delayMs={0} />
        <StatCard icon={Building2} label="Active" value={active} accent="success" delayMs={60} />
        <StatCard icon={Building2} label="Prospects" value={prospects} accent="warning" delayMs={120} />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <p className="font-medium">{a.companyName}</p>
                  {a.accountNo ? <p className="font-mono text-xs text-muted-foreground">{a.accountNo}</p> : null}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.industry ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{[a.city, a.country].filter(Boolean).join(', ') || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.email ?? a.phone ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={STATUS_VARIANT[a.status] ?? 'secondary'}>{a.status.charAt(0) + a.status.slice(1).toLowerCase()}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!isLoading && list.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Building2} title="No accounts yet" description="Add an account, or convert a lead into one." action={<NewAccountDialog />} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
