'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { AgingBucketKey, ApAging, ArAging, BalanceSheet, CashFlow, CostCenterReport, IncomeStatement, StatementLine, TrialBalance } from '@/lib/types';
import { NewCostCenterDialog } from '@/components/finance/new-cost-center-dialog';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type View = 'trial' | 'balance' | 'income' | 'cashflow' | 'aging' | 'apaging' | 'costcenter';

const BUCKET_LABEL: Record<AgingBucketKey, string> = {
  current: 'Current', d1_30: '1–30 days', d31_60: '31–60 days', d61_90: '61–90 days', d90_plus: '90+ days',
};

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
  const aging = useQuery({ queryKey: ['reports', 'aging'], queryFn: () => apiGet<ArAging>('/finance/ar-aging'), enabled: view === 'aging' });
  const apaging = useQuery({ queryKey: ['reports', 'apaging'], queryFn: () => apiGet<ApAging>('/finance/ap-aging'), enabled: view === 'apaging' });
  const cashflow = useQuery({ queryKey: ['reports', 'cashflow'], queryFn: () => apiGet<CashFlow>('/finance/statements/cash-flow'), enabled: view === 'cashflow' });
  const costcenter = useQuery({ queryKey: ['reports', 'costcenter'], queryFn: () => apiGet<CostCenterReport>('/finance/reports/cost-center'), enabled: view === 'costcenter' });

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
            <SelectItem value="cashflow">Cash Flow</SelectItem>
            <SelectItem value="aging">AR Aging</SelectItem>
            <SelectItem value="apaging">AP Aging</SelectItem>
            <SelectItem value="costcenter">Cost Center P&amp;L</SelectItem>
          </SelectContent>
        </Select>
        {view === 'costcenter' ? <NewCostCenterDialog /> : null}
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

      {view === 'cashflow' && cashflow.data ? (
        <Card className="space-y-6 p-6">
          <div className="flex items-center justify-between">
            <span className="font-medium">Cash Flow Statement <span className="text-xs text-muted-foreground">(direct method)</span></span>
            <BalancedBadge ok={cashflow.data.reconciles} />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 text-sm">
            <span className="text-muted-foreground">Opening cash &amp; bank</span>
            <span className="tabular-nums">{formatMoney(cashflow.data.opening.amountMinor)}</span>
          </div>
          <StatementSection title="Operating activities" lines={cashflow.data.operating.lines} totalMinor={cashflow.data.operating.totalMinor} />
          <StatementSection title="Investing activities" lines={cashflow.data.investing.lines} totalMinor={cashflow.data.investing.totalMinor} />
          <StatementSection title="Financing activities" lines={cashflow.data.financing.lines} totalMinor={cashflow.data.financing.totalMinor} />
          <div className="flex items-center justify-between rounded-lg bg-primary/10 px-4 py-3">
            <span className="font-semibold">Net change in cash</span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(cashflow.data.netChangeMinor)}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 text-sm">
            <span className="text-muted-foreground">Closing cash &amp; bank</span>
            <span className="tabular-nums">{formatMoney(cashflow.data.closing.amountMinor)}</span>
          </div>
        </Card>
      ) : null}

      {view === 'aging' && aging.data ? (
        <Card className="space-y-6 p-6">
          <span className="font-medium">Accounts Receivable Aging</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {aging.data.buckets.map((b) => (
              <div key={b} className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">{BUCKET_LABEL[b]}</p>
                <p className="mt-1 font-semibold tabular-nums">{formatMoney(aging.data!.totals[b])}</p>
              </div>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-center">Days past due</TableHead>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aging.data.invoices.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No outstanding invoices.</TableCell></TableRow>
              ) : (
                aging.data.invoices.map((iv) => (
                  <TableRow key={iv.invoiceId}>
                    <TableCell className="font-medium">{iv.number}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{String(iv.dueDate).slice(0, 10)}</TableCell>
                    <TableCell className="text-center tabular-nums">{iv.daysPastDue > 0 ? iv.daysPastDue : '—'}</TableCell>
                    <TableCell>{BUCKET_LABEL[iv.bucket]}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(iv.amount.amountMinor, iv.amount.currency)}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className="border-t-2">
                <TableCell className="font-semibold" colSpan={4}>Total outstanding</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(aging.data.totals.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {view === 'apaging' && apaging.data ? (
        <Card className="space-y-6 p-6">
          <span className="font-medium">Accounts Payable Aging</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {apaging.data.buckets.map((b) => (
              <div key={b} className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">{BUCKET_LABEL[b]}</p>
                <p className="mt-1 font-semibold tabular-nums">{formatMoney(apaging.data!.totals[b])}</p>
              </div>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-center">Days past due</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apaging.data.bills.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No outstanding bills.</TableCell></TableRow>
              ) : (
                apaging.data.bills.map((bl) => (
                  <TableRow key={bl.billId}>
                    <TableCell className="font-medium">{bl.number}</TableCell>
                    <TableCell>{bl.vendorName ?? '—'}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{String(bl.dueDate).slice(0, 10)}</TableCell>
                    <TableCell className="text-center tabular-nums">{bl.daysPastDue > 0 ? bl.daysPastDue : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(bl.amount.amountMinor, bl.amount.currency)}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className="border-t-2">
                <TableCell className="font-semibold" colSpan={4}>Total payable</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(apaging.data.totals.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {view === 'costcenter' && costcenter.data ? (
        <Card className="overflow-hidden">
          <div className="border-b p-4 font-medium">Cost Center P&amp;L</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cost center</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Expense</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costcenter.data.costCenters.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No posted income/expense yet.</TableCell></TableRow>
              ) : (
                costcenter.data.costCenters.map((c) => (
                  <TableRow key={c.costCenterId ?? 'unassigned'}>
                    <TableCell>{c.code ? <span className="font-mono text-xs text-muted-foreground">{c.code} </span> : null}{c.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(c.revenue.amountMinor, c.revenue.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(c.expense.amountMinor, c.expense.currency)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(c.net.amountMinor, c.net.currency)}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className="border-t-2">
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(costcenter.data.totals.revenueMinor)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(costcenter.data.totals.expenseMinor)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(costcenter.data.totals.netMinor)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
