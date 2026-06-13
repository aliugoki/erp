'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { BalanceSheet, IncomeStatement, StatementLine, TrialBalance } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type View = 'trial' | 'balance' | 'income';

function BalancedBadge({ ok }: { ok: boolean }) {
  return (
    <span className={cn('flex items-center gap-1.5 text-sm font-medium', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
      {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      {ok ? 'Balanced' : 'Out of balance'}
    </span>
  );
}

function StatementSection({ title, lines, totalMinor }: { title: string; lines: StatementLine[]; totalMinor: number }) {
  return (
    <div>
      <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <Table>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow><TableCell className="text-muted-foreground">No accounts</TableCell><TableCell /></TableRow>
          ) : (
            lines.map((l) => (
              <TableRow key={l.accountId}>
                <TableCell><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(l.amountMinor)}</TableCell>
              </TableRow>
            ))
          )}
          <TableRow className="border-t-2">
            <TableCell className="font-semibold">Total {title.toLowerCase()}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totalMinor)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

export default function ReportsPage() {
  const [view, setView] = useState<View>('trial');

  const trial = useQuery({ queryKey: ['reports', 'trial'], queryFn: () => apiGet<TrialBalance>('/finance/trial-balance'), enabled: view === 'trial' });
  const balance = useQuery({ queryKey: ['reports', 'balance'], queryFn: () => apiGet<BalanceSheet>('/finance/statements/balance-sheet'), enabled: view === 'balance' });
  const income = useQuery({ queryKey: ['reports', 'income'], queryFn: () => apiGet<IncomeStatement>('/finance/statements/income'), enabled: view === 'income' });

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="Financial statements derived from the general ledger." />
      <FinanceTabs />

      <div className="flex items-center gap-3">
        <Select value={view} onValueChange={(v) => setView(v as View)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="trial">Trial Balance</SelectItem>
            <SelectItem value="balance">Balance Sheet</SelectItem>
            <SelectItem value="income">Income Statement</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {view === 'trial' ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b p-4">
            <span className="font-medium">Trial Balance</span>
            {trial.data ? <BalancedBadge ok={trial.data.balanced} /> : null}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(trial.data?.rows ?? []).map((r) => (
                <TableRow key={r.accountId}>
                  <TableCell><span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.debitMinor ? formatMoney(r.debitMinor) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.creditMinor ? formatMoney(r.creditMinor) : '—'}</TableCell>
                </TableRow>
              ))}
              {trial.data ? (
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Totals</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(trial.data.totals.debitMinor)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(trial.data.totals.creditMinor)}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {view === 'balance' && balance.data ? (
        <Card className="space-y-6 p-6">
          <div className="flex items-center justify-between">
            <span className="font-medium">Balance Sheet</span>
            <BalancedBadge ok={balance.data.balanced} />
          </div>
          <StatementSection title="Assets" lines={balance.data.assets.lines} totalMinor={balance.data.assets.totalMinor} />
          <StatementSection title="Liabilities" lines={balance.data.liabilities.lines} totalMinor={balance.data.liabilities.totalMinor} />
          <StatementSection
            title="Equity"
            lines={[
              ...balance.data.equity.lines,
              { accountId: '__ni', code: '', name: 'Net income (current period)', amountMinor: balance.data.equity.netIncomeMinor },
            ]}
            totalMinor={balance.data.equity.totalMinor}
          />
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
            <span className="font-semibold">Assets = Liabilities + Equity</span>
            <span className="tabular-nums">
              {formatMoney(balance.data.totals.assetsMinor)} = {formatMoney(balance.data.totals.liabilitiesAndEquityMinor)}
            </span>
          </div>
        </Card>
      ) : null}

      {view === 'income' && income.data ? (
        <Card className="space-y-6 p-6">
          <span className="font-medium">Income Statement</span>
          <StatementSection title="Revenue" lines={income.data.revenue.lines} totalMinor={income.data.revenue.totalMinor} />
          <StatementSection title="Expenses" lines={income.data.expenses.lines} totalMinor={income.data.expenses.totalMinor} />
          <div className="flex items-center justify-between rounded-lg bg-primary/10 px-4 py-3">
            <span className="font-semibold">Net income</span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(income.data.netIncomeMinor)}</span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
