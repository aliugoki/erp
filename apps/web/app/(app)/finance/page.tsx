'use client';
import { ModuleTitle } from '@/components/module-title';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownCircle, ArrowLeft, ArrowUpCircle, BookOpen, Building2, CalendarRange, Coins, FileText, Landmark, Layers, Loader2, Lock,
  PlayCircle, Receipt, RefreshCw, Repeat, ScrollText, Search, Target, Unlock, Users, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Account, Bill, CostCenter, Currency, Customer, ExchangeRate, FiscalPeriod, Invoice, JournalTxn, Recurring, Vendor } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import { AccountTypeBadge, StatusBadge, fmtDate } from '@/components/finance/fin-ui';
import { InvoiceDetail } from '@/components/finance/invoice-detail';
import { BillDetail } from '@/components/finance/bill-detail';
import { AccountDetail } from '@/components/finance/account-detail';
import { TransactionDetail } from '@/components/finance/transaction-detail';
import { FinanceReports } from '@/components/finance/finance-reports';
import { GeneralLedger } from '@/components/finance/general-ledger';
import { Reconciliation } from '@/components/finance/reconciliation';
import { NewInvoiceDialog } from '@/components/finance/new-invoice-dialog';
import { NewBillDialog } from '@/components/finance/new-bill-dialog';
import { NewCustomerDialog } from '@/components/finance/new-customer-dialog';
import { NewVendorDialog } from '@/components/finance/new-vendor-dialog';
import { NewAccountDialog } from '@/components/finance/new-account-dialog';
import { NewJournalDialog } from '@/components/finance/new-journal-dialog';
import { QuickTransaction } from '@/components/finance/quick-transaction';
import { NewRecurringDialog } from '@/components/finance/new-recurring-dialog';
import { NewCostCenterDialog } from '@/components/finance/new-cost-center-dialog';
import { YearEndCloseDialog } from '@/components/finance/year-end-close-dialog';

type Section = 'invoices' | 'customers' | 'bills' | 'vendors' | 'accounts' | 'journal' | 'income' | 'expense' | 'ledger' | 'reconciliation' | 'reports' | 'periods' | 'currencies' | 'recurring' | 'costcenters';

export default function FinancePage() {
  const [section, setSection] = useState<Section>('invoices');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const invoices = useQuery({ queryKey: ['invoices'], queryFn: () => apiGet<Invoice[]>('/finance/invoices?pageSize=100'), enabled: section === 'invoices' });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => apiGet<Customer[]>('/finance/customers'), enabled: section === 'customers' });
  const bills = useQuery({ queryKey: ['bills'], queryFn: () => apiGet<Bill[]>('/finance/bills?pageSize=100'), enabled: section === 'bills' });
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => apiGet<Vendor[]>('/finance/vendors'), enabled: section === 'vendors' });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), enabled: section === 'accounts' });
  const txns = useQuery({ queryKey: ['transactions'], queryFn: () => apiGet<JournalTxn[]>('/finance/transactions?pageSize=100'), enabled: section === 'journal' });
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => apiGet<FiscalPeriod[]>('/finance/periods'), enabled: section === 'periods' });
  const recurring = useQuery({ queryKey: ['recurring'], queryFn: () => apiGet<Recurring[]>('/finance/recurring'), enabled: section === 'recurring' });
  const costCenters = useQuery({ queryKey: ['cost-centers'], queryFn: () => apiGet<CostCenter[]>('/finance/cost-centers'), enabled: section === 'costcenters' });

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); };
  const clear = () => setSel(null);
  const fullPane = section === 'ledger' || section === 'reconciliation' || section === 'reports' || section === 'currencies' || section === 'income' || section === 'expense';
  const showDetail = !!sel || fullPane;

  const invList = useMemo(() => (invoices.data ?? []).filter((i) => !q || `${i.number} ${i.customerName ?? ''}`.toLowerCase().includes(q.toLowerCase())), [invoices.data, q]);
  const billList = useMemo(() => (bills.data ?? []).filter((b) => !q || `${b.number} ${b.vendorName ?? ''}`.toLowerCase().includes(q.toLowerCase())), [bills.data, q]);
  const acctList = useMemo(() => (accounts.data ?? []).filter((a) => !q || `${a.code} ${a.name}`.toLowerCase().includes(q.toLowerCase())), [accounts.data, q]);
  const selectedAccount = (accounts.data ?? []).find((a) => a.id === sel);

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={FileText} label="Invoices" active={section === 'invoices'} onClick={() => pick('invoices')} tone="emerald" />
      <RailItem icon={Users} label="Customers" active={section === 'customers'} onClick={() => pick('customers')} />
      <RailItem icon={Receipt} label="Bills" active={section === 'bills'} onClick={() => pick('bills')} tone="amber" />
      <RailItem icon={Building2} label="Vendors" active={section === 'vendors'} onClick={() => pick('vendors')} />
      <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Transaction</p>
      <RailItem icon={ScrollText} label="Journal" active={section === 'journal'} onClick={() => pick('journal')} tone="sky" />
      <RailItem icon={ArrowDownCircle} label="Income" active={section === 'income'} onClick={() => pick('income')} tone="emerald" />
      <RailItem icon={ArrowUpCircle} label="Expense" active={section === 'expense'} onClick={() => pick('expense')} tone="amber" />
      <div className="my-1 border-t" />
      <RailItem icon={Layers} label="Chart of Accounts" active={section === 'accounts'} onClick={() => pick('accounts')} tone="violet" />
      <RailItem icon={BookOpen} label="General Ledger" active={section === 'ledger'} onClick={() => pick('ledger')} />
      <RailItem icon={Landmark} label="Reconciliation" active={section === 'reconciliation'} onClick={() => pick('reconciliation')} />
      <div className="my-1 border-t" />
      <RailItem icon={Wallet} label="Reports" active={section === 'reports'} onClick={() => pick('reports')} tone="violet" />
      <RailItem icon={CalendarRange} label="Periods" active={section === 'periods'} onClick={() => pick('periods')} />
      <RailItem icon={Coins} label="Currencies" active={section === 'currencies'} onClick={() => pick('currencies')} tone="amber" />
      <RailItem icon={Repeat} label="Recurring" active={section === 'recurring'} onClick={() => pick('recurring')} tone="sky" />
      <RailItem icon={Target} label="Cost Centers" active={section === 'costcenters'} onClick={() => pick('costcenters')} />
    </div>
  );

  const searchHeader = (
    <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-9 w-full pl-9" /></div>
  );

  const list = (
    <Pane>
      {section === 'invoices' ? (
        <><PaneHeader>{searchHeader}<NewInvoiceDialog /></PaneHeader><PaneBody>
          {invoices.isLoading ? <Spinner /> : invList.length === 0 ? <Hint>No invoices.</Hint> : (
            <ul className="divide-y">{invList.map((i) => (
              <li key={i.id}><ListRow active={sel === i.id} onClick={() => setSel(i.id)}>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{i.number}</div><div className="truncate text-xs text-muted-foreground">{i.customerName ?? '—'}</div></div>
                <div className="flex flex-col items-end gap-1"><span className="text-xs font-semibold tabular-nums">{formatMoney(i.total.amountMinor, i.total.currency)}</span><StatusBadge status={i.status} /></div>
              </ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : section === 'bills' ? (
        <><PaneHeader>{searchHeader}<NewBillDialog /></PaneHeader><PaneBody>
          {bills.isLoading ? <Spinner /> : billList.length === 0 ? <Hint>No bills.</Hint> : (
            <ul className="divide-y">{billList.map((b) => (
              <li key={b.id}><ListRow active={sel === b.id} onClick={() => setSel(b.id)}>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{b.number}</div><div className="truncate text-xs text-muted-foreground">{b.vendorName ?? '—'}</div></div>
                <div className="flex flex-col items-end gap-1"><span className="text-xs font-semibold tabular-nums">{formatMoney(b.total.amountMinor, b.total.currency)}</span><StatusBadge status={b.status} /></div>
              </ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : section === 'customers' ? (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Customers</span><NewCustomerDialog /></PaneHeader><PaneBody>
          {customers.isLoading ? <Spinner /> : (customers.data ?? []).length === 0 ? <Hint>No customers.</Hint> : (
            <ul className="divide-y">{(customers.data ?? []).map((c) => (
              <li key={c.id}><ListRow active={sel === c.id} onClick={() => setSel(c.id)}><div className="min-w-0 flex-1"><div className="truncate font-medium">{c.name}</div><div className="truncate text-xs text-muted-foreground">{c.email ?? c.accountCode ?? '—'}</div></div></ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : section === 'vendors' ? (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Vendors</span><NewVendorDialog /></PaneHeader><PaneBody>
          {vendors.isLoading ? <Spinner /> : (vendors.data ?? []).length === 0 ? <Hint>No vendors.</Hint> : (
            <ul className="divide-y">{(vendors.data ?? []).map((v) => (
              <li key={v.id}><ListRow active={sel === v.id} onClick={() => setSel(v.id)}><div className="min-w-0 flex-1"><div className="truncate font-medium">{v.name}</div><div className="truncate text-xs text-muted-foreground">{v.email ?? v.accountCode ?? '—'}</div></div></ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : section === 'accounts' ? (
        <><PaneHeader>{searchHeader}<NewAccountDialog accounts={accounts.data ?? []} /></PaneHeader><PaneBody>
          {accounts.isLoading ? <Spinner /> : acctList.length === 0 ? <Hint>No accounts.</Hint> : (
            <ul className="divide-y">{acctList.map((a) => (
              <li key={a.id}><ListRow active={sel === a.id} onClick={() => setSel(a.id)}>
                <div className="min-w-0 flex-1" style={{ paddingLeft: `${Math.max(0, (a.level ?? 1) - 1) * 12}px` }}><div className="flex items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{a.code}</span><span className={`truncate ${a.isGroup ? 'font-semibold' : ''}`}>{a.name}</span></div></div>
                <AccountTypeBadge type={a.type} />
              </ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : section === 'journal' ? (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Journal</span><NewJournalDialog /></PaneHeader><PaneBody>
          {txns.isLoading ? <Spinner /> : (txns.data ?? []).length === 0 ? <Hint>No vouchers.</Hint> : (
            <ul className="divide-y">{(txns.data ?? []).map((t) => (
              <li key={t.id}><ListRow active={sel === t.id} onClick={() => setSel(t.id)}>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{t.voucherNo ?? 'Draft'} <span className="text-xs text-muted-foreground">{t.voucherType}</span></div><div className="truncate text-xs text-muted-foreground">{t.description}</div></div>
                <div className="flex flex-col items-end gap-1"><span className="text-xs font-semibold tabular-nums">{formatMoney(t.total.amountMinor, t.total.currency)}</span><StatusBadge status={t.status} /></div>
              </ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : section === 'periods' ? (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Fiscal periods</span><CreatePeriod /></PaneHeader><PaneBody>
          {periods.isLoading ? <Spinner /> : (periods.data ?? []).length === 0 ? <Hint>No periods.</Hint> : (
            <ul className="divide-y">{(periods.data ?? []).map((p) => (
              <li key={p.id}><ListRow active={sel === p.id} onClick={() => setSel(p.id)}><div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="truncate text-xs text-muted-foreground">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</div></div><StatusBadge status={p.status} /></ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : section === 'recurring' ? (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Recurring</span><RunDue /><NewRecurringDialog /></PaneHeader><PaneBody>
          {recurring.isLoading ? <Spinner /> : (recurring.data ?? []).length === 0 ? <Hint>No templates.</Hint> : (
            <ul className="divide-y">{(recurring.data ?? []).map((r) => (
              <li key={r.id}><ListRow active={sel === r.id} onClick={() => setSel(r.id)}><div className="min-w-0 flex-1"><div className="truncate font-medium">{r.description}</div><div className="truncate text-xs text-muted-foreground">{r.frequency} · next {fmtDate(r.nextRunDate)}</div></div><StatusBadge status={r.active ? 'OPEN' : 'CLOSED'} /></ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : section === 'costcenters' ? (
        <><PaneHeader><span className="flex-1 text-sm font-medium">Cost centers</span><NewCostCenterDialog /></PaneHeader><PaneBody>
          {costCenters.isLoading ? <Spinner /> : (costCenters.data ?? []).length === 0 ? <Hint>No cost centers.</Hint> : (
            <ul className="divide-y">{(costCenters.data ?? []).map((c) => (
              <li key={c.id}><ListRow><div className="min-w-0 flex-1"><div className="truncate font-medium">{c.name}</div><div className="truncate text-xs text-muted-foreground">{c.code}</div></div></ListRow></li>
            ))}</ul>
          )}
        </PaneBody></>
      ) : (
        <><PaneHeader><span className="flex-1 text-sm font-medium capitalize">{section}</span></PaneHeader><PaneBody><div className="p-2"><ListRow active><Wallet className="h-4 w-4 text-violet-600" /><span className="flex-1 font-medium capitalize">{section}</span></ListRow></div></PaneBody></>
      )}
    </Pane>
  );

  const detail = (
    <Pane>
      {section === 'invoices' ? (sel ? <InvoiceDetail id={sel} onBack={clear} /> : <EmptyDetail icon={FileText} title="Select an invoice" hint="View lines and receive payment." />)
        : section === 'bills' ? (sel ? <BillDetail id={sel} onBack={clear} /> : <EmptyDetail icon={Receipt} title="Select a bill" hint="View lines, payments, and pay." />)
        : section === 'customers' ? (sel ? <PartyDetail party={(customers.data ?? []).find((c) => c.id === sel)} onBack={clear} /> : <EmptyDetail icon={Users} title="Customers" hint="Subsidiary receivable ledgers." />)
        : section === 'vendors' ? (sel ? <PartyDetail party={(vendors.data ?? []).find((v) => v.id === sel)} onBack={clear} /> : <EmptyDetail icon={Building2} title="Vendors" hint="Subsidiary payable ledgers." />)
        : section === 'accounts' ? (selectedAccount ? <AccountDetail account={selectedAccount} onBack={clear} /> : <EmptyDetail icon={Layers} title="Chart of accounts" hint="Select an account to edit its details." />)
        : section === 'journal' ? (sel ? <TransactionDetail id={sel} onBack={clear} /> : <EmptyDetail icon={ScrollText} title="Select a voucher" hint="Post drafts, reverse posted vouchers." />)
        : section === 'periods' ? (sel ? <PeriodDetail period={(periods.data ?? []).find((p) => p.id === sel)} onBack={clear} /> : <EmptyDetail icon={CalendarRange} title="Fiscal periods" hint="Lock periods and run year-end close." />)
        : section === 'recurring' ? (sel ? <RecurringDetail item={(recurring.data ?? []).find((r) => r.id === sel)} onBack={clear} /> : <EmptyDetail icon={Repeat} title="Recurring vouchers" hint="Run a template to generate its voucher." />)
        : section === 'costcenters' ? <EmptyDetail icon={Target} title="Cost centers" hint="Analytical dimensions for postings. Add them on the left." />
        : section === 'income' ? <QuickTransaction kind="income" />
        : section === 'expense' ? <QuickTransaction kind="expense" />
        : section === 'ledger' ? <GeneralLedger />
        : section === 'reconciliation' ? <Reconciliation />
        : section === 'currencies' ? <CurrencyPanel />
        : <FinanceReports />}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <ModuleTitle>Finance</ModuleTitle>
        <p className="text-sm text-muted-foreground">Accounting suite — invoicing, payables, the general ledger, and financial statements.</p>
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

function PartyDetail({ party, onBack }: { party?: Customer | Vendor; onBack?: () => void }) {
  if (!party) return <EmptyDetail icon={Users} title="Not found" />;
  return (
    <>
      <PaneHeader>{onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}<span className="flex-1 truncate font-semibold">{party.name}</span></PaneHeader>
      <PaneBody className="p-5"><dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
        <Cell label="Email" value={party.email ?? '—'} /><Cell label="Phone" value={party.phone ?? '—'} />
        <Cell label="Ledger account" value={party.accountCode ? `${party.accountCode} · ${party.accountName ?? ''}` : '—'} />
      </dl></PaneBody>
    </>
  );
}

function PeriodDetail({ period, onBack }: { period?: FiscalPeriod; onBack?: () => void }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => apiPatch(`/finance/periods/${period!.id}`, { status: period!.status === 'OPEN' ? 'CLOSED' : 'OPEN' }),
    onSuccess: () => { toast.success('Period updated'); void qc.invalidateQueries({ queryKey: ['periods'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  if (!period) return <EmptyDetail icon={CalendarRange} title="Not found" />;
  return (
    <>
      <PaneHeader>{onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}<span className="flex-1 truncate font-semibold">{period.name}</span><StatusBadge status={period.status} /></PaneHeader>
      <PaneBody className="space-y-4 p-5">
        <dl className="grid max-w-md grid-cols-2 gap-4 text-sm"><Cell label="Start" value={fmtDate(period.startDate)} /><Cell label="End" value={fmtDate(period.endDate)} /></dl>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => toggle.mutate()} disabled={toggle.isPending}>{period.status === 'OPEN' ? <><Lock className="mr-2 h-4 w-4" /> Lock period</> : <><Unlock className="mr-2 h-4 w-4" /> Reopen</>}</Button>
          <YearEndCloseDialog period={period} />
        </div>
      </PaneBody>
    </>
  );
}

function RecurringDetail({ item, onBack }: { item?: Recurring; onBack?: () => void }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => apiPost<{ voucherNo?: string }>(`/finance/recurring/${item!.id}/run`, {}),
    onSuccess: (r) => { toast.success(`Generated ${r?.voucherNo ?? 'voucher'}`); void qc.invalidateQueries({ queryKey: ['recurring'] }); void qc.invalidateQueries({ queryKey: ['transactions'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  if (!item) return <EmptyDetail icon={Repeat} title="Not found" />;
  return (
    <>
      <PaneHeader>{onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}<span className="flex-1 truncate font-semibold">{item.description}</span><Button size="sm" onClick={() => run.mutate()} disabled={run.isPending || !item.active}>{run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />} Run now</Button></PaneHeader>
      <PaneBody className="p-5"><dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
        <Cell label="Frequency" value={item.frequency} /><Cell label="Voucher type" value={item.voucherType} />
        <Cell label="Next run" value={fmtDate(item.nextRunDate)} /><Cell label="Ends" value={fmtDate(item.endDate)} />
        <Cell label="Lines" value={String(item.entries.length)} /><Cell label="Active" value={item.active ? 'Yes' : 'No'} />
      </dl></PaneBody>
    </>
  );
}

function CurrencyPanel() {
  const qc = useQueryClient();
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: () => apiGet<Currency[]>('/finance/currencies') });
  const rates = useQuery({ queryKey: ['exchange-rates'], queryFn: () => apiGet<ExchangeRate[]>('/finance/exchange-rates') });
  const [c, setC] = useState({ code: '', name: '', symbol: '' });
  const [r, setR] = useState({ currencyCode: '', rate: '' });
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const addCurrency = useMutation({ mutationFn: () => apiPost('/finance/currencies', { code: c.code.toUpperCase(), name: c.name, symbol: c.symbol || undefined }), onSuccess: () => { toast.success('Currency added'); setC({ code: '', name: '', symbol: '' }); void qc.invalidateQueries({ queryKey: ['currencies'] }); }, onError: onErr });
  const setRate = useMutation({ mutationFn: () => apiPost('/finance/exchange-rates', { currencyCode: r.currencyCode.toUpperCase(), rate: Number(r.rate) }), onSuccess: () => { toast.success('Rate set'); setR({ currencyCode: '', rate: '' }); void qc.invalidateQueries({ queryKey: ['exchange-rates'] }); }, onError: onErr });

  return (
    <>
      <PaneHeader><span className="font-semibold">Currencies &amp; exchange rates</span></PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <Input value={c.code} onChange={(e) => setC((s) => ({ ...s, code: e.target.value }))} placeholder="USD" maxLength={3} className="h-9 w-20" />
            <Input value={c.name} onChange={(e) => setC((s) => ({ ...s, name: e.target.value }))} placeholder="US Dollar" className="h-9 w-40" />
            <Input value={c.symbol} onChange={(e) => setC((s) => ({ ...s, symbol: e.target.value }))} placeholder="$" className="h-9 w-16" />
            <Button size="sm" disabled={c.code.length !== 3 || !c.name.trim() || addCurrency.isPending} onClick={() => addCurrency.mutate()}>Add currency</Button>
          </div>
          <div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Code</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Symbol</th><th className="px-4 py-2">Base</th></tr></thead><tbody className="divide-y">
            {(currencies.data ?? []).map((cur) => <tr key={cur.id}><td className="px-4 py-2 font-mono">{cur.code}</td><td className="px-4 py-2">{cur.name}</td><td className="px-4 py-2">{cur.symbol ?? '—'}</td><td className="px-4 py-2">{cur.isBase ? '✓' : ''}</td></tr>)}
          </tbody></table></div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exchange rates</h3>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <Input value={r.currencyCode} onChange={(e) => setR((s) => ({ ...s, currencyCode: e.target.value }))} placeholder="USD" maxLength={3} className="h-9 w-20" />
            <Input value={r.rate} onChange={(e) => setR((s) => ({ ...s, rate: e.target.value }))} type="number" step="0.0001" placeholder="Rate to base" className="h-9 w-40" />
            <Button size="sm" disabled={r.currencyCode.length !== 3 || !Number(r.rate) || setRate.isPending} onClick={() => setRate.mutate()}>Set rate</Button>
          </div>
          <div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2">Currency</th><th className="px-4 py-2 text-right">Rate</th><th className="px-4 py-2 text-right">As of</th></tr></thead><tbody className="divide-y">
            {(rates.data ?? []).map((rate) => <tr key={rate.id}><td className="px-4 py-2 font-mono">{rate.currencyCode}</td><td className="px-4 py-2 text-right tabular-nums">{rate.rate}</td><td className="px-4 py-2 text-right text-muted-foreground">{fmtDate(rate.asOf)}</td></tr>)}
          </tbody></table></div>
        </section>
      </PaneBody>
    </>
  );
}

function CreatePeriod() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', startDate: '', endDate: '' });
  const create = useMutation({
    mutationFn: () => apiPost('/finance/periods', { name: f.name, startDate: new Date(f.startDate).toISOString(), endDate: new Date(f.endDate).toISOString() }),
    onSuccess: () => { toast.success('Period created'); setF({ name: '', startDate: '', endDate: '' }); setOpen(false); void qc.invalidateQueries({ queryKey: ['periods'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>New</Button>;
  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="FY2026" className="h-9 w-28" />
      <Input value={f.startDate} onChange={(e) => setF((s) => ({ ...s, startDate: e.target.value }))} type="date" className="h-9 w-36" />
      <Input value={f.endDate} onChange={(e) => setF((s) => ({ ...s, endDate: e.target.value }))} type="date" className="h-9 w-36" />
      <Button size="sm" disabled={!f.name.trim() || !f.startDate || !f.endDate || create.isPending} onClick={() => create.mutate()}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function RunDue() {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => apiPost<{ generated: number }>('/finance/recurring/run-due', {}),
    onSuccess: (res) => { toast.success(`${res?.generated ?? 0} voucher(s) generated`); void qc.invalidateQueries({ queryKey: ['recurring'] }); void qc.invalidateQueries({ queryKey: ['transactions'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  return <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Run due</Button>;
}

function Cell({ label, value }: { label: string; value: string }) { return <div><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>; }
function Spinner() { return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Hint({ children }: { children: React.ReactNode }) { return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>; }
