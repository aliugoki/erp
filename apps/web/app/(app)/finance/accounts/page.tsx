'use client';
import { useQuery } from '@tanstack/react-query';
import { Folder, ListTree, Tag } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { Account, AccountType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { NewAccountDialog } from '@/components/finance/new-account-dialog';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const TYPE_VARIANT: Record<AccountType, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  ASSET: 'success',
  LIABILITY: 'warning',
  EQUITY: 'secondary',
  REVENUE: 'success',
  EXPENSE: 'destructive',
};

export default function ChartOfAccountsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts') });
  const accounts = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader
        title="Finance"
        description="Chart of accounts — a multi-level tree of groups and postable accounts."
        action={<NewAccountDialog accounts={accounts} />}
      />
      <FinanceTabs />

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Kind</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                  </TableRow>
                ))
              : accounts.map((a) => (
                  <TableRow key={a.id} className={cn(a.isGroup && 'bg-muted/30')}>
                    <TableCell>
                      <span className="flex items-center gap-2" style={{ paddingLeft: `${((a.level ?? 1) - 1) * 20}px` }}>
                        {a.isGroup ? <Folder className="size-4 text-muted-foreground" /> : <Tag className="size-4 text-muted-foreground" />}
                        <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                        <span className={cn(a.isGroup && 'font-semibold')}>{a.name}</span>
                        {a.controlType !== 'NONE' ? (
                          <Badge variant="secondary" className="ml-1">{a.controlType === 'BANK' ? `Bank${a.bankName ? ` · ${a.bankName}` : ''}` : 'Cash'}</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell><Badge variant={TYPE_VARIANT[a.type]}>{a.type}</Badge></TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      <span className="mr-2 rounded bg-muted px-1.5 py-0.5 font-mono">L{a.level ?? 1}</span>
                      {a.isGroup ? 'Group' : 'Postable'}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {!isLoading && accounts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={ListTree}
              title="No accounts yet"
              description="Create your first account or a group header to organise the chart."
              action={<NewAccountDialog accounts={accounts} />}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
