'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Activity, CreditCard, Layers, Loader2, Plus, Repeat, Search, TrendingUp, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { SubMetrics, SubPlan, Subscription } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { PlansAdmin } from '@/components/subscriptions/plans-admin';
import { NewSubscriptionDialog } from '@/components/subscriptions/new-subscription-dialog';
import { InvoiceStatusBadge, SubStatusBadge, fmtDate, intervalLabel, timeUntil } from '@/components/subscriptions/ui';

const TABS = [
  { key: 'subscriptions', label: 'Subscriptions', icon: Repeat },
  { key: 'plans', label: 'Plans', icon: Layers },
  { key: 'invoices', label: 'Invoices', icon: CreditCard },
  { key: 'accounting', label: 'Accounting', icon: Wallet },
] as const;

const STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED'];

export default function SubscriptionsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('subscriptions');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const metrics = useQuery({ queryKey: ['sub-metrics'], queryFn: () => apiGet<SubMetrics>('/subscriptions/metrics') });
  const plans = useQuery({ queryKey: ['sub-plans'], queryFn: () => apiGet<SubPlan[]>('/subscriptions/plans') });
  const subs = useQuery({
    queryKey: ['subs', status, q],
    queryFn: () => {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (q) p.set('q', q);
      return apiGet<Subscription[]>(`/subscriptions${p.toString() ? `?${p}` : ''}`);
    },
  });

  const m = metrics.data;
  const list = subs.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">Recurring billing — plans, automatic invoicing, dunning, and MRR.</p>
        </div>
        <Button size="sm" onClick={() => setNewOpen(true)} disabled={(plans.data ?? []).filter((p) => p.status === 'ACTIVE').length === 0}><Plus className="mr-2 h-4 w-4" /> New subscription</Button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="MRR" value={m ? formatMoney(m.mrr.amountMinor, m.mrr.currency) : '—'} icon={TrendingUp} tone="emerald" />
        <Metric label="ARR" value={m ? formatMoney(m.arr.amountMinor, m.arr.currency) : '—'} icon={Wallet} />
        <Metric label="Active" value={m ? String(m.active + m.trialing) : '—'} sub={m ? `${m.trialing} trialing` : ''} icon={Activity} tone="sky" />
        <Metric label="Past due" value={m ? String(m.pastDue) : '—'} sub={m && m.churnRate > 0 ? `${m.churnRate}% churn` : ''} icon={Repeat} tone={m && m.pastDue > 0 ? 'amber' : 'default'} />
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'subscriptions' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search #, customer, email…" className="w-56 pl-9" />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-2">Subscription</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Next bill</th></tr>
              </thead>
              <tbody className="divide-y">
                {subs.isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                ) : list.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><Repeat className="mx-auto mb-2 h-6 w-6" />No subscriptions match.</td></tr>
                ) : list.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5"><Link href={`/subscriptions/${s.id}`} className="font-medium hover:underline">{s.subscriptionNo}</Link></td>
                    <td className="px-4 py-2.5"><div>{s.customerName}</div><div className="text-xs text-muted-foreground">{s.customerEmail}</div></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{s.planName} <span className="text-xs">· {intervalLabel(s.billingInterval, s.intervalCount)}</span></td>
                    <td className="px-4 py-2.5 tabular-nums">{formatMoney(s.amount.amountMinor, s.amount.currency)}{s.quantity > 1 ? <span className="text-xs text-muted-foreground"> ×{s.quantity}</span> : null}</td>
                    <td className="px-4 py-2.5"><SubStatusBadge status={s.status} />{s.cancelAtPeriodEnd && s.status !== 'CANCELLED' ? <span className="ml-1 text-[10px] text-muted-foreground">ends soon</span> : null}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{['CANCELLED', 'EXPIRED'].includes(s.status) ? '—' : <>{fmtDate(s.nextBillingAt)}<div>{timeUntil(s.nextBillingAt)}</div></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'plans' ? <PlansAdmin /> : null}
      {tab === 'invoices' ? <InvoicesTab /> : null}
      {tab === 'accounting' ? (
        <GlAccountsCard
          title="Subscriptions → general ledger"
          description="When set, each paid subscription invoice posts Dr clearing; Cr revenue (+ tax). Requires background reactions enabled."
          getPath="/subscriptions/gl-config"
          putPath="/subscriptions/gl-config"
          queryKey="sub-gl-config"
          slots={[
            { key: 'clearingAccountId', label: 'Clearing / receipts (Dr)', required: true },
            { key: 'revenueAccountId', label: 'Subscription revenue (Cr)', types: ['REVENUE'], required: true },
            { key: 'taxAccountId', label: 'Tax payable (Cr)', types: ['LIABILITY'] },
          ]}
        />
      ) : null}

      {newOpen ? <NewSubscriptionDialog plans={plans.data ?? []} onClose={() => setNewOpen(false)} /> : null}
    </div>
  );
}

function InvoicesTab() {
  const [status, setStatus] = useState('');
  const invoices = useQuery({
    queryKey: ['sub-invoices', status],
    queryFn: () => apiGet<import('@/lib/types').SubInvoice[]>(`/subscriptions/invoices/all${status ? `?status=${status}` : ''}`),
  });
  const list = invoices.data ?? [];
  return (
    <div className="space-y-4">
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
        <option value="">All invoices</option>
        {['OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">Invoice</th><th className="px-4 py-2">Subscription</th><th className="px-4 py-2">Period</th><th className="px-4 py-2">Total</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Issued</th></tr>
          </thead>
          <tbody className="divide-y">
            {invoices.isLoading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No invoices yet.</td></tr>
            ) : list.map((i) => (
              <tr key={i.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium">{i.invoiceNo}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{i.subscriptionNo}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(i.total.amountMinor, i.total.currency)}</td>
                <td className="px-4 py-2.5"><InvoiceStatusBadge status={i.status} /></td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{fmtDate(i.issuedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, sub = '', icon: Icon, tone = 'default' }: { label: string; value: string; sub?: string; icon: typeof Repeat; tone?: 'default' | 'emerald' | 'sky' | 'amber' }) {
  const tones: Record<string, string> = { default: 'text-primary', emerald: 'text-emerald-600', sky: 'text-sky-600', amber: 'text-amber-600' };
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${tones[tone]}`} />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
