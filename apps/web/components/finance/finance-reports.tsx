'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { AgingBucketKey, ApAging, ArAging, BalanceSheet, CashFlow, IncomeStatement, StatementLine, TrialBalance } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { cn } from '@/lib/utils';

type Tab = 'tb' | 'bs' | 'is' | 'cf' | 'ar' | 'ap';

const TABS: { key: Tab; label: string }[] = [
  { key: 'tb', label: 'Trial Balance' },
  { key: 'bs', label: 'Balance Sheet' },
  { key: 'is', label: 'Income' },
  { key: 'cf', label: 'Cash Flow' },
  { key: 'ar', label: 'AR Aging' },
  { key: 'ap', label: 'AP Aging' },
];

const BUCKET_LABEL: Record<AgingBucketKey, string> = {
  current: 'Current', d1_30: '1–30', d31_60: '31–60', d61_90: '61–90', d90_plus: '90+',
};

function Spinner() {
  return <div className="flex flex-1 items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
}

function Balanced({ ok }: { ok: boolean }) {
  return (
    <span className={cn('flex items-center gap-1.5 text-sm font-medium', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
      {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      {ok ? 'Balanced' : 'Out of balance'}
    </span>
  );
}

function Section({ title, lines, totalMinor, currency }: { title: string; lines: StatementLine[]; totalMinor: number; currency?: string }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {lines.length === 0 ? (
              <tr><td className="px-4 py-2 text-muted-foreground">No accounts</td><td /></tr>
            ) : (
              lines.map((l) => (
                <tr key={l.accountId}>
                  <td className="px-4 py-2"><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.amountMinor, currency)}</td>
                </tr>
              ))
            )}
            <tr className="border-t-2 bg-muted/40">
              <td className="px-4 py-2 font-semibold">Total {title.toLowerCase()}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(totalMinor, currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrialBalanceReport() {
  const q = useQuery({ queryKey: ['reports-trial-balance'], queryFn: () => apiGet<TrialBalance>('/finance/trial-balance') });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trial Balance</h3>
        <Balanced ok={d.balanced} />
      </div>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Code</th><th className="px-4 py-2">Account</th><th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th></tr></thead>
          <tbody className="divide-y">
            {d.rows.map((r) => (
              <tr key={r.accountId}>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.code}</td>
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.debitMinor ? formatMoney(r.debitMinor) : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.creditMinor ? formatMoney(r.creditMinor) : '—'}</td>
              </tr>
            ))}
            <tr className="border-t-2 bg-muted/40">
              <td className="px-4 py-2 font-semibold" colSpan={2}>Totals</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(d.totals.debitMinor)}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(d.totals.creditMinor)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BalanceSheetReport() {
  const q = useQuery({ queryKey: ['reports-balance-sheet'], queryFn: () => apiGet<BalanceSheet>('/finance/statements/balance-sheet') });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balance Sheet</h3>
        <Balanced ok={d.balanced} />
      </div>
      <Section title="Assets" lines={d.assets.lines} totalMinor={d.assets.totalMinor} currency={d.currency} />
      <Section title="Liabilities" lines={d.liabilities.lines} totalMinor={d.liabilities.totalMinor} currency={d.currency} />
      <Section
        title="Equity"
        lines={[...d.equity.lines, { accountId: '__ni', code: '', name: 'Net income (current period)', amountMinor: d.equity.netIncomeMinor }]}
        totalMinor={d.equity.totalMinor}
        currency={d.currency}
      />
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
        <span className="font-semibold">Assets = Liabilities + Equity</span>
        <span className="tabular-nums">{formatMoney(d.totals.assetsMinor, d.currency)} = {formatMoney(d.totals.liabilitiesAndEquityMinor, d.currency)}</span>
      </div>
    </div>
  );
}

function IncomeReport() {
  const q = useQuery({ queryKey: ['reports-income'], queryFn: () => apiGet<IncomeStatement>('/finance/statements/income') });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Income Statement</h3>
      <Section title="Revenue" lines={d.revenue.lines} totalMinor={d.revenue.totalMinor} currency={d.currency} />
      <Section title="Expenses" lines={d.expenses.lines} totalMinor={d.expenses.totalMinor} currency={d.currency} />
      <div className="flex items-center justify-between rounded-lg bg-primary/10 px-4 py-3">
        <span className="font-semibold">Net income</span>
        <span className="text-lg font-semibold tabular-nums">{formatMoney(d.netIncomeMinor, d.currency)}</span>
      </div>
    </div>
  );
}

function CashFlowReport() {
  const q = useQuery({ queryKey: ['reports-cashflow'], queryFn: () => apiGet<CashFlow>('/finance/statements/cash-flow') });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash Flow Statement</h3>
        <Balanced ok={d.reconciles} />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">Opening cash &amp; bank</span>
        <span className="tabular-nums">{formatMoney(d.opening.amountMinor, d.opening.currency)}</span>
      </div>
      <Section title="Operating activities" lines={d.operating.lines} totalMinor={d.operating.totalMinor} currency={d.currency} />
      <Section title="Investing activities" lines={d.investing.lines} totalMinor={d.investing.totalMinor} currency={d.currency} />
      <Section title="Financing activities" lines={d.financing.lines} totalMinor={d.financing.totalMinor} currency={d.currency} />
      <div className="flex items-center justify-between rounded-lg bg-primary/10 px-4 py-3">
        <span className="font-semibold">Net change in cash</span>
        <span className="text-lg font-semibold tabular-nums">{formatMoney(d.netChangeMinor, d.currency)}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">Closing cash &amp; bank</span>
        <span className="tabular-nums">{formatMoney(d.closing.amountMinor, d.closing.currency)}</span>
      </div>
    </div>
  );
}

function BucketSummary({ buckets, totals }: { buckets: AgingBucketKey[]; totals: Record<AgingBucketKey | 'total', number> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
      {buckets.map((b) => (
        <div key={b} className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground">{BUCKET_LABEL[b]}</p>
          <p className="mt-1 font-semibold tabular-nums">{formatMoney(totals[b])}</p>
        </div>
      ))}
      <div className="rounded-lg border bg-muted/40 p-3 text-center">
        <p className="text-xs text-muted-foreground">Total</p>
        <p className="mt-1 font-semibold tabular-nums">{formatMoney(totals.total)}</p>
      </div>
    </div>
  );
}

function ArAgingReport() {
  const q = useQuery({ queryKey: ['reports-ar-aging'], queryFn: () => apiGet<ArAging>('/finance/ar-aging') });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accounts Receivable Aging</h3>
      <BucketSummary buckets={d.buckets} totals={d.totals} />
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Invoice</th><th className="px-4 py-2">Due</th><th className="px-4 py-2 text-center">Days past due</th><th className="px-4 py-2">Bucket</th><th className="px-4 py-2 text-right">Outstanding</th></tr></thead>
          <tbody className="divide-y">
            {d.invoices.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No outstanding invoices.</td></tr>
            ) : (
              d.invoices.map((iv) => (
                <tr key={iv.invoiceId}>
                  <td className="px-4 py-2 font-medium">{iv.number}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{String(iv.dueDate).slice(0, 10)}</td>
                  <td className="px-4 py-2 text-center tabular-nums">{iv.daysPastDue > 0 ? iv.daysPastDue : '—'}</td>
                  <td className="px-4 py-2">{BUCKET_LABEL[iv.bucket]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(iv.amount.amountMinor, iv.amount.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApAgingReport() {
  const q = useQuery({ queryKey: ['reports-ap-aging'], queryFn: () => apiGet<ApAging>('/finance/ap-aging') });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accounts Payable Aging</h3>
      <BucketSummary buckets={d.buckets} totals={d.totals} />
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Bill</th><th className="px-4 py-2">Vendor</th><th className="px-4 py-2">Due</th><th className="px-4 py-2 text-center">Days past due</th><th className="px-4 py-2 text-right">Outstanding</th></tr></thead>
          <tbody className="divide-y">
            {d.bills.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No outstanding bills.</td></tr>
            ) : (
              d.bills.map((bl) => (
                <tr key={bl.billId}>
                  <td className="px-4 py-2 font-medium">{bl.number}</td>
                  <td className="px-4 py-2">{bl.vendorName ?? '—'}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{String(bl.dueDate).slice(0, 10)}</td>
                  <td className="px-4 py-2 text-center tabular-nums">{bl.daysPastDue > 0 ? bl.daysPastDue : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(bl.amount.amountMinor, bl.amount.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sub-tabbed read-only financial statements + aging reports, derived from the general ledger. */
export function FinanceReports() {
  const [tab, setTab] = useState<Tab>('tb');
  return (
    <>
      <PaneHeader>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn('rounded-md px-2.5 py-1 text-sm transition', tab === t.key ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        {tab === 'tb' ? <TrialBalanceReport /> : null}
        {tab === 'bs' ? <BalanceSheetReport /> : null}
        {tab === 'is' ? <IncomeReport /> : null}
        {tab === 'cf' ? <CashFlowReport /> : null}
        {tab === 'ar' ? <ArAgingReport /> : null}
        {tab === 'ap' ? <ApAgingReport /> : null}
      </PaneBody>
    </>
  );
}
