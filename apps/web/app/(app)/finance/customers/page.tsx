'use client';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Customer } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { NewCustomerDialog } from '@/components/finance/new-customer-dialog';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function CustomersPage() {
  const { data, isLoading } = useQuery({ queryKey: ['customers'], queryFn: () => apiGet<Customer[]>('/finance/customers') });
  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader
        title="Finance"
        description="Customers — billable parties, each with its own receivable account."
        action={<NewCustomerDialog />}
      />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Ledger account</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                  </TableRow>
                ))
              : rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone ?? '—'}</TableCell>
                    <TableCell>
                      {c.accountCode
                        ? <Badge variant="secondary" className="font-mono">{c.accountCode} · {c.accountName}</Badge>
                        : <span className="text-xs text-muted-foreground">No receivables control configured</span>}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Users} title="No customers" description="Add a customer to start invoicing." action={<NewCustomerDialog />} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
